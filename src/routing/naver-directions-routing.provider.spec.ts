import type { ConfigService } from '@nestjs/config';
import { DistanceBasedRoutingProvider } from './distance-based-routing.provider';
import { NaverDirectionsRoutingProvider } from './naver-directions-routing.provider';

describe('NaverDirectionsRoutingProvider', () => {
  const originalFetch = global.fetch;
  const config = {
    getOrThrow: jest.fn((name: string) => {
      const values: Record<string, string> = {
        NAVER_DIRECTIONS_URL: 'https://naver.example/map-direction/v1',
        NAVER_MAPS_API_KEY_ID: 'maps-id',
        NAVER_MAPS_API_KEY: 'maps-secret',
      };
      return values[name];
    }),
  } as unknown as ConfigService;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('uses NAVER measured distance and duration only for taxi/car routing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          code: 0,
          currentDateTime: '2026-08-25T13:00:00',
          route: {
            traoptimal: [
              {
                summary: { distance: 2_450, duration: 720_000 },
                path: [
                  [126.95, 37.55],
                  [126.97, 37.56],
                ],
              },
            ],
          },
        }),
    }) as jest.MockedFunction<typeof fetch>;
    const provider = new NaverDirectionsRoutingProvider(config, new DistanceBasedRoutingProvider());

    const result = await provider.measureLeg(
      { type: 'Point', coordinates: [126.95, 37.55] },
      { type: 'Point', coordinates: [126.97, 37.56] },
      'taxi',
    );

    expect(result).toMatchObject({
      distanceKm: 2.45,
      durationMinutes: 12,
      method: 'naver-directions-driving',
      evidence: 'measured',
      transportMode: 'car',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not disguise NAVER driving directions as public transit', async () => {
    global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    const provider = new NaverDirectionsRoutingProvider(config, new DistanceBasedRoutingProvider());
    const result = await provider.measureLeg(
      { type: 'Point', coordinates: [126.95, 37.55] },
      { type: 'Point', coordinates: [126.97, 37.56] },
      'subway',
    );

    expect(result.evidence).toBe('estimated');
    expect(result.method).toBe('straight-line-walking-estimate');
    expect(result.disclaimer).toContain('자동차 전용');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
