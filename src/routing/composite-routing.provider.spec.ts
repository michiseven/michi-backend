import { ConfigService } from '@nestjs/config';
import type { GeoPoint } from '../database/entities';
import { CompositeRoutingProvider } from './composite-routing.provider';
import { DistanceBasedRoutingProvider } from './distance-based-routing.provider';
import type { NaverDirectionsRoutingProvider } from './naver-directions-routing.provider';
import type { SeoulBusRoutingProvider } from './seoul-bus-routing.provider';
import type { SeoulSubwayRoutingProvider } from './seoul-subway-routing.provider';

describe('CompositeRoutingProvider', () => {
  const origin: GeoPoint = { type: 'Point', coordinates: [126.951592, 37.54322] };
  const destination: GeoPoint = { type: 'Point', coordinates: [126.985474, 37.576477] };

  let composite: CompositeRoutingProvider;
  let naverTaxiMock: { measureLeg: jest.Mock };
  let seoulSubwayMock: { measureLeg: jest.Mock };
  let seoulBusMock: { measureLeg: jest.Mock };
  let distanceMock: DistanceBasedRoutingProvider;

  beforeEach(() => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'ROUTING_PROVIDER_MODE') return 'live';
        if (key === 'ROUTING_SHORT_WALK_MAX_METERS') return 1_000;
        if (key === 'ROUTING_SHORT_WALK_MIN_SAVINGS_MINUTES') return 3;
        return undefined;
      }),
    } as unknown as ConfigService;

    distanceMock = new DistanceBasedRoutingProvider();
    naverTaxiMock = {
      measureLeg: jest
        .fn()
        .mockResolvedValue({ method: 'naver-directions-driving', transportMode: 'car' }),
    };
    seoulSubwayMock = {
      measureLeg: jest.fn().mockResolvedValue({
        distanceKm: 5,
        durationMinutes: 22,
        method: 'seoul-subway-path-v1',
        transportMode: 'subway',
        evidence: 'mixed',
        disclaimer: 'test subway',
      }),
    };
    seoulBusMock = {
      measureLeg: jest.fn().mockResolvedValue({
        method: 'seoul-bus-estimate-v1',
        transportMode: 'bus',
        evidence: 'estimated',
      }),
    };

    composite = new CompositeRoutingProvider(
      config,
      distanceMock,
      naverTaxiMock as unknown as NaverDirectionsRoutingProvider,
      seoulSubwayMock as unknown as SeoulSubwayRoutingProvider,
      seoulBusMock as unknown as SeoulBusRoutingProvider,
    );
  });

  it('delegates taxi requests to NaverDirectionsRoutingProvider', async () => {
    const result = await composite.measureLeg(origin, destination, 'taxi');
    expect(naverTaxiMock.measureLeg).toHaveBeenCalledWith(origin, destination, 'taxi');
    expect(result.transportMode).toBe('car');
  });

  it('delegates subway requests to SeoulSubwayRoutingProvider', async () => {
    const result = await composite.measureLeg(origin, destination, 'subway', {
      travelDate: '2026-08-29',
    });
    expect(seoulSubwayMock.measureLeg).toHaveBeenCalledWith(origin, destination, 'subway', {
      travelDate: '2026-08-29',
    });
    expect(result.transportMode).toBe('subway');
  });

  it('delegates bus requests to SeoulBusRoutingProvider', async () => {
    const result = await composite.measureLeg(origin, destination, 'bus');
    expect(seoulBusMock.measureLeg).toHaveBeenCalledWith(origin, destination, 'bus');
    expect(result.transportMode).toBe('bus');
  });

  it('delegates walk requests to DistanceBasedRoutingProvider', async () => {
    const result = await composite.measureLeg(origin, destination, 'walk');
    expect(result.transportMode).toBe('walk');
    expect(result.method).toBe('straight-line-walking-estimate');
  });

  it('uses walking for a short leg when it is meaningfully faster than subway', async () => {
    const nearby: GeoPoint = { type: 'Point', coordinates: [126.957, 37.54322] };
    seoulSubwayMock.measureLeg.mockResolvedValue({
      distanceKm: 2,
      durationMinutes: 18,
      method: 'seoul-subway-path-v1',
      transportMode: 'subway',
      evidence: 'mixed',
      disclaimer: 'test subway',
    });

    const result = await composite.measureLeg(origin, nearby, 'subway', {
      maxWalkMinutes: 15,
    });

    expect(result.transportMode).toBe('walk');
    expect(result.requestedTransportMode).toBe('subway');
    expect(result.durationMinutes).toBeLessThan(18);
    expect(result.disclaimer).toContain('지하철 우선 요청');
  });

  it('keeps subway when short-walk substitution is disabled for mobility constraints', async () => {
    const nearby: GeoPoint = { type: 'Point', coordinates: [126.957, 37.54322] };
    seoulSubwayMock.measureLeg.mockResolvedValue({
      distanceKm: 2,
      durationMinutes: 18,
      method: 'seoul-subway-path-v1',
      transportMode: 'subway',
      evidence: 'mixed',
      disclaimer: 'test subway',
    });

    const result = await composite.measureLeg(origin, nearby, 'subway', {
      allowShortWalkSubstitution: false,
    });

    expect(result.transportMode).toBe('subway');
  });

  it('keeps subway when walking would exceed the user walk limit', async () => {
    const nearby: GeoPoint = { type: 'Point', coordinates: [126.957, 37.54322] };
    seoulSubwayMock.measureLeg.mockResolvedValue({
      distanceKm: 2,
      durationMinutes: 18,
      method: 'seoul-subway-path-v1',
      transportMode: 'subway',
      evidence: 'mixed',
      disclaimer: 'test subway',
    });

    const result = await composite.measureLeg(origin, nearby, 'subway', {
      maxWalkMinutes: 5,
    });

    expect(result.transportMode).toBe('subway');
  });
});
