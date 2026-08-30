import { Injectable } from '@nestjs/common';
import type { GeoPoint } from '../database/entities';
import { coordinatesOf, haversineDistanceKm } from '../recommendation/geo';
import type { RouteLegEstimate, RoutingProvider } from './routing-provider';

const WALKING_SPEED_KMH = 4.5;
const MIN_TRAVEL_MINUTES = 5;
const UNKNOWN_TRAVEL_MINUTES = 15;

@Injectable()
export class DistanceBasedRoutingProvider implements RoutingProvider {
  readonly name = 'distance-based-v1';
  readonly mode = 'mock' as const;

  planningEstimate(
    originLocation: GeoPoint | null,
    destinationLocation: GeoPoint | null,
  ): RouteLegEstimate {
    const origin = coordinatesOf(originLocation);
    const destination = coordinatesOf(destinationLocation);
    if (!origin || !destination) {
      return {
        distanceKm: null,
        durationMinutes: UNKNOWN_TRAVEL_MINUTES,
        method: 'straight-line-walking-estimate',
        evidence: 'estimated',
        transportMode: 'walk',
        disclaimer: '좌표가 없어 15분 기본 이동시간을 사용한 추정값입니다.',
      };
    }
    const distanceKm = haversineDistanceKm(origin, destination);
    return {
      distanceKm,
      durationMinutes: Math.max(
        MIN_TRAVEL_MINUTES,
        Math.ceil((distanceKm / WALKING_SPEED_KMH) * 60),
      ),
      method: 'straight-line-walking-estimate',
      evidence: 'estimated',
      transportMode: 'walk',
      disclaimer: '직선거리와 시속 4.5km 보행 속도로 계산한 추정값이며 실제 길찾기가 아닙니다.',
    };
  }

  measureLeg(
    originLocation: GeoPoint | null,
    destinationLocation: GeoPoint | null,
    requestedMode: import('./routing-provider').RequestedTransportMode,
  ): Promise<RouteLegEstimate> {
    return Promise.resolve({
      ...this.planningEstimate(originLocation, destinationLocation),
      requestedTransportMode: requestedMode,
    });
  }
}
