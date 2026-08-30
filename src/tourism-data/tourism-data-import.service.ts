import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Place, TourismDataSource, TourismImportRun, TourismMetric } from '../database/entities';
import { parseCanonicalTourismData } from './canonical-tourism-data.parser';
import type { CanonicalTourismMetric, TourismImportSummary } from './tourism-data.types';

export interface ImportTourismBufferOptions {
  fileName: string;
  bytes: Uint8Array;
  format?: 'csv' | 'json';
  encoding?: string;
  runMetadata?: Record<string, unknown>;
}

function inferFormat(fileName: string): 'csv' | 'json' {
  const extension = fileName.toLowerCase().split('.').at(-1);
  if (extension === 'csv' || extension === 'json') return extension;
  throw new Error('Tourism import file must use .csv or .json, or specify a format');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function tourismMetricDimensionKey(metric: CanonicalTourismMetric): string {
  const identity = {
    subject:
      metric.placeSource && metric.sourcePlaceId
        ? { placeSource: metric.placeSource, sourcePlaceId: metric.sourcePlaceId }
        : { areaCode: metric.areaCode, areaName: metric.areaName },
    metricType: metric.metricType,
    unit: metric.unit,
    periodStart: metric.periodStart,
    periodEnd: metric.periodEnd,
    dimensions: metric.dimensions,
  };
  return createHash('sha256').update(canonicalJson(identity)).digest('hex');
}

@Injectable()
export class TourismDataImportService {
  constructor(
    @InjectRepository(TourismDataSource)
    private readonly sources: Repository<TourismDataSource>,
    @InjectRepository(TourismImportRun)
    private readonly importRuns: Repository<TourismImportRun>,
    private readonly dataSource: DataSource,
  ) {}

  async importBuffer(options: ImportTourismBufferOptions): Promise<TourismImportSummary> {
    const format = options.format ?? inferFormat(options.fileName);
    const encoding = options.encoding ?? 'utf-8';
    let text: string;
    try {
      text = new TextDecoder(encoding, { fatal: true }).decode(options.bytes);
    } catch {
      throw new Error(`Tourism import file could not be decoded as ${encoding}`);
    }
    const parsed = parseCanonicalTourismData(text, format);
    const fileSha256 = createHash('sha256').update(options.bytes).digest('hex');

    const sourceEntity = this.sources.create({ ...parsed.source });
    await this.sources.upsert(
      sourceEntity as unknown as Parameters<Repository<TourismDataSource>['upsert']>[0],
      { conflictPaths: ['datasetKey'], skipUpdateIfNoValuesChanged: true },
    );
    const source = await this.sources.findOneByOrFail({ datasetKey: parsed.source.datasetKey });
    const previous = await this.importRuns.findOneBy({ sourceId: source.id, fileSha256 });
    if (previous?.status === 'completed') {
      if (options.runMetadata && Object.keys(options.runMetadata).length > 0) {
        await this.importRuns.update(previous.id, {
          metadata: {
            ...(previous.metadata ?? {}),
            ...options.runMetadata,
          },
        } as unknown as Parameters<Repository<TourismImportRun>['update']>[1]);
      }
      return {
        importRunId: previous.id,
        datasetKey: source.datasetKey,
        fileName: previous.fileName,
        fileSha256,
        mode: previous.mode,
        skipped: true,
        accepted: previous.acceptedCount,
        rejected: previous.rejectedCount,
        rejections: [],
      };
    }

    const startedAt = new Date();
    const run = await this.importRuns.save(
      this.importRuns.create({
        ...previous,
        sourceId: source.id,
        fileName: options.fileName,
        fileSha256,
        referencePeriod: parsed.referencePeriod,
        mode: parsed.mode,
        status: 'processing',
        acceptedCount: 0,
        rejectedCount: parsed.rejections.length,
        startedAt,
        completedAt: null,
        metadata: { schemaVersion: parsed.schemaVersion, format, encoding },
      }),
    );
    const rejections = [...parsed.rejections];

    try {
      const accepted = await this.dataSource.transaction(async (manager) => {
        const places = manager.getRepository(Place);
        const metrics = manager.getRepository(TourismMetric);
        const placeIds = new Map<string, string | null>();
        const metricRows: TourismMetric[] = [];

        for (const entry of parsed.metrics) {
          const metric = entry.metric;
          let placeId: string | null = null;
          if (metric.placeSource && metric.sourcePlaceId) {
            const identity = `${metric.placeSource}:${metric.sourcePlaceId}`;
            if (!placeIds.has(identity)) {
              const place = await places.findOne({
                select: { id: true },
                where: { source: metric.placeSource, sourcePlaceId: metric.sourcePlaceId },
              });
              placeIds.set(identity, place?.id ?? null);
            }
            placeId = placeIds.get(identity) ?? null;
            if (!placeId) {
              rejections.push({
                row: entry.row,
                code: 'PLACE_NOT_FOUND',
                message: `No Place matches ${metric.placeSource}:${metric.sourcePlaceId}`,
              });
              continue;
            }
          }
          metricRows.push(
            metrics.create({
              sourceId: source.id,
              importRunId: run.id,
              placeId,
              areaCode: metric.areaCode,
              areaName: metric.areaName,
              metricType: metric.metricType,
              value: metric.value,
              unit: metric.unit,
              periodStart: metric.periodStart,
              periodEnd: metric.periodEnd,
              dimensions: metric.dimensions,
              dimensionKey: tourismMetricDimensionKey(metric),
              metadata: metric.metadata,
            }),
          );
        }

        if (metricRows.length > 0) {
          await metrics.upsert(
            metricRows as unknown as Parameters<Repository<TourismMetric>['upsert']>[0],
            {
              conflictPaths: ['sourceId', 'dimensionKey'],
              skipUpdateIfNoValuesChanged: true,
            },
          );
        }
        await manager.getRepository(TourismImportRun).update(run.id, {
          status: 'completed',
          acceptedCount: metricRows.length,
          rejectedCount: rejections.length,
          completedAt: new Date(),
          metadata: {
            ...run.metadata,
            ...(options.runMetadata ?? {}),
            rejectionCodes: [...new Set(rejections.map((rejection) => rejection.code))],
          },
        } as unknown as Parameters<Repository<TourismImportRun>['update']>[1]);
        return metricRows.length;
      });

      return {
        importRunId: run.id,
        datasetKey: source.datasetKey,
        fileName: options.fileName,
        fileSha256,
        mode: parsed.mode,
        skipped: false,
        accepted,
        rejected: rejections.length,
        rejections,
      };
    } catch (error) {
      await this.importRuns.update(run.id, {
        status: 'failed',
        acceptedCount: 0,
        rejectedCount: rejections.length,
        completedAt: new Date(),
        metadata: {
          ...run.metadata,
          failureType: error instanceof Error ? error.name : 'UnknownError',
        },
      });
      throw error;
    }
  }
}
