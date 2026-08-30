import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GeoPoint } from '../database/entities';
import { coordinatesOf } from '../recommendation/geo';
import { TransitStationService } from '../transit/transit-station.service';
import { DistanceBasedRoutingProvider } from './distance-based-routing.provider';
import type { RequestedTransportMode, RouteLegEstimate, RoutingProvider } from './routing-provider';

export interface BusStopInfo {
  stationId: string;
  stationName: string;
  arsId?: string;
  longitude: number;
  latitude: number;
  distanceMeters: number;
}

@Injectable()
export class SeoulBusRoutingProvider implements RoutingProvider {
  readonly name = 'seoul-bus-estimate-v1';

  constructor(
    private readonly config: ConfigService,
    private readonly fallback: DistanceBasedRoutingProvider,
    private readonly transitStations: TransitStationService,
  ) {}

  get mode(): 'mock' | 'live' {
    return this.config.get<string>('SEOUL_BUS_PROVIDER_MODE') === 'live' ? 'live' : 'mock';
  }

  planningEstimate(origin: GeoPoint | null, destination: GeoPoint | null): RouteLegEstimate {
    return this.fallback.planningEstimate(origin, destination);
  }

  measureLeg(
    origin: GeoPoint | null,
    destination: GeoPoint | null,
    requestedMode: RequestedTransportMode,
  ): Promise<RouteLegEstimate> {
    const estimate = this.fallback.planningEstimate(origin, destination);
    if (!origin || !destination) {
      return Promise.resolve({
        ...estimate,
        requestedTransportMode: requestedMode,
        disclaimer: '좌표가 없어 버스 경로를 계산할 수 없습니다.',
      });
    }

    const originCoords = coordinatesOf(origin);
    const destCoords = coordinatesOf(destination);
    if (!originCoords || !destCoords) {
      return Promise.resolve({
        ...estimate,
        requestedTransportMode: requestedMode,
        disclaimer: '유효한 좌표가 없어 버스 경로를 계산할 수 없습니다.',
      });
    }

    // Bus point-to-point transit routing API is deprecated/terminated in Seoul Open Data.
    // Return honest estimated walking fallback with precise disclaimer.
    return Promise.resolve({
      distanceKm: estimate.distanceKm,
      durationMinutes: estimate.durationMinutes,
      method: 'seoul-bus-estimate-v1',
      evidence: 'estimated',
      transportMode: 'bus',
      requestedTransportMode: requestedMode,
      measuredAt: new Date().toISOString(),
      busDetails: {
        note: '공식 버스 P2P 통합 환승 API가 종료되어 보행 추정값을 대안으로 제공합니다.',
      },
      disclaimer:
        '현재 공식 서울 버스 point-to-point 실측 길찾기 API는 제공되지 않아 보행 추정값을 사용했습니다.',
    });
  }

  async getNearbyBusStops(
    point: GeoPoint | null,
    radiusMeters: number = 500,
  ): Promise<BusStopInfo[]> {
    const coords = coordinatesOf(point);
    if (!coords) return [];

    if (this.mode === 'mock') {
      return [
        {
          stationId: 'mock-bus-stop-1',
          stationName: '인근 버스정류소',
          arsId: '14001',
          longitude: coords.longitude,
          latitude: coords.latitude,
          distanceMeters: Math.min(100, radiusMeters),
        },
      ];
    }

    const nearby = await this.transitStations.findNearbyBusStops(point, radiusMeters, 10);
    return nearby.map(({ station, distanceMeters }) => ({
      stationId: station.stationCode,
      stationName: station.stationName,
      ...(typeof station.rawMetadata.arsId === 'string'
        ? { arsId: station.rawMetadata.arsId }
        : {}),
      longitude: station.location.coordinates[0],
      latitude: station.location.coordinates[1],
      distanceMeters,
    }));
  }
}
