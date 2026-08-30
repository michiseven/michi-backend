import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { TourismDataSource, TourismImportRun } from '../database/entities';
import { TourismDataImportService, tourismMetricDimensionKey } from './tourism-data-import.service';
import type { CanonicalTourismMetric } from './tourism-data.types';

function repository<T extends object>(overrides: object): Repository<T> {
  return overrides as Repository<T>;
}

function mockDocument(): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 'michi-tourism-metric-v1',
      source: {
        datasetKey: 'mock-dataset',
        name: '[MOCK] dataset',
        sourceName: 'MOCK',
        url: 'https://example.invalid/mock',
        licenseUseCondition: 'synthetic',
        updateCycle: null,
        spatialGranularity: 'mock area',
        temporalGranularity: 'mock month',
        apiAvailable: false,
        csvAvailable: false,
        metadata: { fixture: true },
      },
      referencePeriod: 'MOCK-2026-01',
      mode: 'mock',
      metrics: [
        {
          areaCode: 'MOCK-A',
          areaName: '[MOCK] A',
          placeSource: null,
          sourcePlaceId: null,
          metricType: 'mock_count',
          value: 10,
          unit: 'synthetic_count',
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          dimensions: { segment: 'MOCK' },
          metadata: { fixture: true },
        },
      ],
    }),
  );
}

describe('TourismDataImportService', () => {
  it('uses a stable dimension key independent of JSON property order', () => {
    const metric = {
      areaCode: 'A',
      areaName: 'Area',
      placeSource: null,
      sourcePlaceId: null,
      metricType: 'visitor_count',
      value: 10,
      unit: 'person',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      dimensions: { nationality: 'JP', age: '20s' },
      metadata: {},
    } satisfies CanonicalTourismMetric;
    expect(tourismMetricDimensionKey(metric)).toBe(
      tourismMetricDimensionKey({ ...metric, dimensions: { age: '20s', nationality: 'JP' } }),
    );
  });

  it('imports metrics in a transaction and skips an already completed checksum', async () => {
    const source = { id: 'source-id', datasetKey: 'mock-dataset' } as TourismDataSource;
    const sourceRepository = repository<TourismDataSource>({
      create: jest.fn((value: object) => value),
      upsert: jest.fn().mockResolvedValue(undefined),
      findOneByOrFail: jest.fn().mockResolvedValue(source),
    });
    const runRepository = repository<TourismImportRun>({
      create: jest.fn((value: object) => value),
      findOneBy: jest.fn().mockResolvedValueOnce(null),
      save: jest.fn((value: object) => Promise.resolve({ id: 'run-id', ...value })),
      update: jest.fn().mockResolvedValue(undefined),
    });
    const metricUpsert = jest.fn().mockResolvedValue(undefined);
    const runUpdate = jest.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if ((entity as { name?: string }).name === 'Place') return { findOne: jest.fn() };
        if ((entity as { name?: string }).name === 'TourismMetric') {
          return { create: (value: object): object => value, upsert: metricUpsert };
        }
        return { update: runUpdate };
      }),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn((callback: (value: EntityManager) => Promise<unknown>) =>
        callback(manager),
      ),
    } as unknown as DataSource;
    const service = new TourismDataImportService(sourceRepository, runRepository, dataSource);
    const bytes = mockDocument();

    const first = await service.importBuffer({ fileName: 'mock.json', bytes });
    const checksum = first.fileSha256;
    (runRepository.findOneBy as jest.Mock).mockResolvedValueOnce({
      id: 'run-id',
      fileName: 'mock.json',
      fileSha256: checksum,
      mode: 'mock',
      status: 'completed',
      acceptedCount: 1,
      rejectedCount: 0,
    });
    const second = await service.importBuffer({ fileName: 'mock.json', bytes });

    expect(first).toMatchObject({ skipped: false, accepted: 1, rejected: 0 });
    expect(metricUpsert).toHaveBeenCalledTimes(1);
    expect(runUpdate).toHaveBeenCalledWith(
      'run-id',
      expect.objectContaining({ status: 'completed' }),
    );
    expect(second).toMatchObject({ skipped: true, accepted: 1 });
  });
});
