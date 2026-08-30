import { DistanceBasedRoutingProvider } from './distance-based-routing.provider';

describe('DistanceBasedRoutingProvider', () => {
  const provider = new DistanceBasedRoutingProvider();

  it('returns a deterministic walking estimate from verified coordinates', () => {
    const result = provider.planningEstimate(
      { type: 'Point', coordinates: [127.0436, 37.5467] },
      { type: 'Point', coordinates: [127.05, 37.544] },
    );
    expect(result.method).toBe('straight-line-walking-estimate');
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.durationMinutes).toBeGreaterThanOrEqual(5);
  });

  it('marks distance unknown instead of inventing coordinates', () => {
    expect(provider.planningEstimate(null, null)).toEqual({
      distanceKm: null,
      durationMinutes: 15,
      method: 'straight-line-walking-estimate',
      evidence: 'estimated',
      transportMode: 'walk',
      disclaimer: '좌표가 없어 15분 기본 이동시간을 사용한 추정값입니다.',
    });
  });
});
