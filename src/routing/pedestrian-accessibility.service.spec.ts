import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { PedestrianAccessibilityService } from './pedestrian-accessibility.service';

describe('PedestrianAccessibilityService', () => {
  const config = {
    get: jest.fn((name: string) => {
      if (name === 'ACCESSIBILITY_STEEP_SLOPE_PERCENT') return 8;
      if (name === 'ACCESSIBILITY_CORRIDOR_METERS') return 20;
      return 200;
    }),
  } as unknown as ConfigService;

  it('keeps evidence unavailable when no GIS rows are loaded', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([{ dataset_count: '0' }]),
    } as unknown as DataSource;
    const result = await new PedestrianAccessibilityService(dataSource, config).evaluateLeg(
      { type: 'Point', coordinates: [126.95, 37.55] },
      { type: 'Point', coordinates: [126.96, 37.56] },
    );
    expect(result).toMatchObject({ status: 'unavailable', risk: 'unknown' });
  });

  it('detects stairs and derives grade from official elevation evidence', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        {
          dataset_count: '30',
          corridor_count: '4',
          stairs_count: '1',
          steep_count: '0',
          explicit_max_slope: null,
          start_elevation: 10,
          end_elevation: 20,
          leg_distance_meters: 100,
          source_refs: ['https://data.seoul.go.kr/dataList/OA-22241/F/1/datasetView.do'],
        },
      ]),
    } as unknown as DataSource;
    const result = await new PedestrianAccessibilityService(dataSource, config).evaluateLeg(
      { type: 'Point', coordinates: [126.95, 37.55] },
      { type: 'Point', coordinates: [126.96, 37.56] },
    );
    expect(result).toMatchObject({
      status: 'checked',
      risk: 'steep-and-stairs',
      derivedGradePercent: 10,
      stairFeatureCount: 1,
    });
  });
});
