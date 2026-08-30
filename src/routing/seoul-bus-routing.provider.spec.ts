import { ConfigService } from '@nestjs/config';
import type { GeoPoint } from '../database/entities';
import { DistanceBasedRoutingProvider } from './distance-based-routing.provider';
import { SeoulBusRoutingProvider } from './seoul-bus-routing.provider';
import type { TransitStationService } from '../transit/transit-station.service';

describe('SeoulBusRoutingProvider', () => {
  const origin: GeoPoint = { type: 'Point', coordinates: [126.951592, 37.54322] };
  const destination: GeoPoint = { type: 'Point', coordinates: [126.985474, 37.576477] };

  const createProvider = (mode: 'mock' | 'live' = 'mock'): SeoulBusRoutingProvider => {
    const config = {
      get: (key: string) => (key === 'SEOUL_BUS_PROVIDER_MODE' ? mode : undefined),
    } as unknown as ConfigService;
    const fallback = new DistanceBasedRoutingProvider();
    const transitStations = {
      findNearbyBusStops: jest.fn().mockResolvedValue([]),
    } as unknown as TransitStationService;
    return new SeoulBusRoutingProvider(config, fallback, transitStations);
  };

  it('returns honest estimated evidence with clear disclaimer for bus route requests', async () => {
    const provider = createProvider('mock');
    const result = await provider.measureLeg(origin, destination, 'bus');

    expect(result.method).toBe('seoul-bus-estimate-v1');
    expect(result.evidence).toBe('estimated');
    expect(result.transportMode).toBe('bus');
    expect(result.requestedTransportMode).toBe('bus');
    expect(result.disclaimer).toContain('point-to-point');
    expect(result.busDetails?.note).toContain('종료');
  });

  it('returns mock nearby bus stops when mode is mock', async () => {
    const provider = createProvider('mock');
    const stops = await provider.getNearbyBusStops(origin, 500);

    expect(stops).toHaveLength(1);
    expect(stops[0]!.stationName).toBe('인근 버스정류소');
  });
});
