import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TourismMetric } from '../database/entities';
import type { CandidatePlace } from '../recommendation/ports';
import {
  calculateTourismConcentration,
  percentileRank,
  type TourismConcentrationFeature,
  type TourismConcentrationInput,
} from './tourism-concentration';
import type {
  TourismDataMode,
  TourismPlaceFeatureEvidence,
  TourismSourceEvidence,
} from './tourism-feature.types';

const CONCENTRATION_METRICS: readonly TourismConcentrationFeature[] = [
  'visitor_count',
  'concentration_forecast_index',
  'navigation_search_count',
  'tourism_consumption_amount',
];
const FLOW_METRICS = ['related_place_flow', 'tourism_flow_strength'] as const;
const SUPPORTED_METRICS = [...CONCENTRATION_METRICS, ...FLOW_METRICS];

interface LoadedMetric extends TourismMetric {
  source: TourismMetric['source'];
  importRun: TourismMetric['importRun'];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function cohortKey(metric: LoadedMetric): string {
  return [
    metric.sourceId,
    metric.metricType,
    metric.unit,
    metric.periodStart ?? '',
    metric.periodEnd ?? '',
    stableJson(metric.dimensions),
  ].join('|');
}

function metricPeriod(metric: LoadedMetric): string | null {
  if (metric.periodStart && metric.periodEnd) return `${metric.periodStart}~${metric.periodEnd}`;
  return metric.periodEnd ?? metric.periodStart ?? metric.importRun.referencePeriod;
}

function subjectMatches(
  metric: LoadedMetric,
  place: CandidatePlace,
  contextAreaNames: readonly string[],
): boolean {
  if (metric.placeId) return metric.placeId === place.placeId;
  const area = metric.areaName?.normalize('NFKC').trim();
  if (!area) return false;
  const searchable = [place.district, place.address, place.roadAddress]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .normalize('NFKC');
  return (
    searchable.includes(area) ||
    contextAreaNames.some((context) => {
      const normalized = context.normalize('NFKC');
      return normalized.includes(area) || area.includes(normalized);
    })
  );
}

function newest(left: LoadedMetric, right: LoadedMetric): LoadedMetric {
  const leftKey = `${left.periodEnd ?? ''}|${left.periodStart ?? ''}|${left.createdAt.toISOString()}`;
  const rightKey = `${right.periodEnd ?? ''}|${right.periodStart ?? ''}|${right.createdAt.toISOString()}`;
  return rightKey > leftKey ? right : left;
}

function includesTargetDate(metric: LoadedMetric, targetDate: string | undefined): boolean {
  if (!targetDate) return true;
  if (metric.periodStart && metric.periodStart > targetDate) return false;
  if (metric.periodEnd && metric.periodEnd < targetDate) return false;
  return true;
}

function dataModeOf(metrics: readonly LoadedMetric[]): TourismDataMode {
  const modes = new Set(metrics.map((metric) => metric.importRun.mode));
  if (modes.size === 0) return 'unavailable';
  if (modes.size > 1) return 'mixed';
  return modes.has('live') ? 'live' : 'mock';
}

function sourceEvidence(metric: LoadedMetric): TourismSourceEvidence {
  return {
    sourceRef: metric.source.datasetKey,
    sourceName: metric.source.sourceName,
    dataset: metric.source.name,
    sourceUrl: metric.source.url,
    referencePeriod: metricPeriod(metric),
    importedAt: metric.importRun.completedAt?.toISOString() ?? metric.createdAt.toISOString(),
    mode: metric.importRun.mode,
  };
}

@Injectable()
export class TourismFeatureService {
  constructor(
    @InjectRepository(TourismMetric)
    private readonly metrics: Repository<TourismMetric>,
  ) {}

  async forPlaces(
    places: readonly CandidatePlace[],
    contextAreaNames: readonly string[] = [],
    targetDate?: string,
  ): Promise<Map<string, TourismPlaceFeatureEvidence>> {
    if (places.length === 0) return new Map();
    const loaded = (await this.metrics.find({
      where: { metricType: In([...SUPPORTED_METRICS]) },
      relations: { source: true, importRun: true },
    })) as LoadedMetric[];
    const peerValues = new Map<string, number[]>();
    for (const metric of loaded) {
      const key = cohortKey(metric);
      peerValues.set(key, [...(peerValues.get(key) ?? []), metric.value]);
    }

    const result = new Map<string, TourismPlaceFeatureEvidence>();
    for (const place of places) {
      const matching = loaded.filter(
        (metric) =>
          includesTargetDate(metric, targetDate) && subjectMatches(metric, place, contextAreaNames),
      );
      const selected = new Map<string, LoadedMetric>();
      for (const metric of matching) {
        const current = selected.get(metric.metricType);
        selected.set(metric.metricType, current ? newest(current, metric) : metric);
      }
      const concentrationInput: TourismConcentrationInput = {};
      for (const metricType of CONCENTRATION_METRICS) {
        const metric = selected.get(metricType);
        if (!metric) continue;
        concentrationInput[metricType] = {
          value: metric.value,
          peerValues: peerValues.get(cohortKey(metric)) ?? [],
        };
      }
      const flowMetric = FLOW_METRICS.map((type) => selected.get(type)).find(
        (metric): metric is LoadedMetric => Boolean(metric),
      );
      const flow = flowMetric
        ? percentileRank(flowMetric.value, peerValues.get(cohortKey(flowMetric)) ?? [])
        : null;
      const usedMetrics = [
        ...CONCENTRATION_METRICS.map((type) => selected.get(type)),
        flowMetric,
      ].filter((metric): metric is LoadedMetric => Boolean(metric));
      const sourceMap = new Map<string, TourismSourceEvidence>();
      for (const metric of usedMetrics) {
        const source = sourceEvidence(metric);
        sourceMap.set(`${source.sourceRef}|${source.referencePeriod}|${source.mode}`, source);
      }
      const areaMetric = usedMetrics.find((metric) => !metric.placeId);
      result.set(place.placeId, {
        concentration: calculateTourismConcentration(concentrationInput),
        tourismFlow: flow,
        referencePeriod:
          usedMetrics
            .map(metricPeriod)
            .filter((period): period is string => Boolean(period))
            .sort()
            .at(-1) ?? null,
        spatialScope: usedMetrics.some((metric) => metric.placeId) ? 'place' : 'area',
        areaName: areaMetric?.areaName ?? place.district,
        dataMode: dataModeOf(usedMetrics),
        sources: [...sourceMap.values()],
      });
    }
    return result;
  }
}
