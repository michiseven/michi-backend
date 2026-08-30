import type { Repository } from 'typeorm';
import type { TourismMetric } from '../database/entities';
import type { CandidatePlace } from '../recommendation/ports';
import { TourismFeatureService } from './tourism-feature.service';

function place(id: string, district: string): CandidatePlace {
  return {
    placeId: id,
    source: 'kto-tour-jpn',
    sourcePlaceId: id,
    name: id,
    category: 'cafe',
    address: `서울특별시 ${district}`,
    roadAddress: null,
    location: { type: 'Point', coordinates: [127, 37.5] },
    district,
    rawCategory: null,
    rawPayload: {},
  };
}

function metric(areaName: string, value: number): TourismMetric {
  return {
    id: `${areaName}-${value}`,
    sourceId: 'source-1',
    source: {
      datasetKey: 'visitor-count',
      name: '지역별 방문자 수',
      sourceName: '한국관광 데이터랩',
      url: 'https://example.com/official',
    },
    importRunId: 'run-1',
    importRun: {
      mode: 'live',
      referencePeriod: '2026-07',
      completedAt: new Date('2026-08-17T00:00:00Z'),
    },
    placeId: null,
    areaCode: areaName,
    areaName,
    metricType: 'visitor_count',
    value,
    unit: 'persons',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    dimensions: {},
    dimensionKey: `${areaName}-key`,
    metadata: {},
    createdAt: new Date('2026-08-17T00:00:00Z'),
  } as TourismMetric;
}

describe('TourismFeatureService', () => {
  it('calculates relative concentration from an actual imported peer cohort and retains lineage', async () => {
    const repository = {
      find: jest.fn().mockResolvedValue([metric('성동구', 100), metric('마포구', 50)]),
    } as unknown as Repository<TourismMetric>;
    const service = new TourismFeatureService(repository);

    const result = await service.forPlaces([
      place('seongsu', '성동구'),
      place('hongdae', '마포구'),
    ]);

    expect(result.get('seongsu')?.concentration).toMatchObject({
      concentration: 0.75,
      dispersion: 0.25,
    });
    expect(result.get('hongdae')?.concentration).toMatchObject({
      concentration: 0.25,
      dispersion: 0.75,
    });
    expect(result.get('seongsu')?.sources[0]).toMatchObject({
      sourceRef: 'visitor-count',
      mode: 'live',
      referencePeriod: '2026-07-01~2026-07-31',
    });
  });

  it('returns unavailable values instead of inventing a score when no metric matches', async () => {
    const repository = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<TourismMetric>;
    const service = new TourismFeatureService(repository);

    const evidence = (await service.forPlaces([place('seongsu', '성동구')])).get('seongsu');

    expect(evidence?.concentration.concentration).toBeNull();
    expect(evidence?.tourismFlow).toBeNull();
    expect(evidence?.sources).toEqual([]);
    expect(evidence?.dataMode).toBe('unavailable');
  });

  it('uses only the metric whose period contains the requested travel date', async () => {
    const old = metric('성동구', 10);
    const forecast = {
      ...metric('성동구', 80),
      id: 'forecast',
      periodStart: '2026-08-22',
      periodEnd: '2026-08-22',
      metricType: 'concentration_forecast_index',
      unit: 'relative_index_0_100',
      dimensionKey: 'forecast-key',
    } as TourismMetric;
    const repository = {
      find: jest.fn().mockResolvedValue([old, forecast]),
    } as unknown as Repository<TourismMetric>;
    const service = new TourismFeatureService(repository);

    const evidence = (await service.forPlaces([place('seongsu', '성동구')], [], '2026-08-22')).get(
      'seongsu',
    );

    expect(evidence?.concentration.features.concentration_forecast_index).toMatchObject({
      observedValue: 80,
    });
    expect(evidence?.concentration.features.visitor_count).toBeUndefined();
  });
});
