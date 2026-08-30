import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GeoPoint } from '../database/entities';
import { DistanceBasedRoutingProvider } from './distance-based-routing.provider';
import { NaverDirectionsRoutingProvider } from './naver-directions-routing.provider';
import type {
  MeasureLegOptions,
  RequestedTransportMode,
  RouteLegEstimate,
  RoutingProvider,
} from './routing-provider';
import { SeoulBusRoutingProvider } from './seoul-bus-routing.provider';
import { SeoulSubwayRoutingProvider } from './seoul-subway-routing.provider';

@Injectable()
export class CompositeRoutingProvider implements RoutingProvider {
  readonly name = 'composite-routing-v1';

  constructor(
    private readonly config: ConfigService,
    private readonly distanceFallback: DistanceBasedRoutingProvider,
    private readonly naverTaxiProvider: NaverDirectionsRoutingProvider,
    private readonly seoulSubwayProvider: SeoulSubwayRoutingProvider,
    private readonly seoulBusProvider: SeoulBusRoutingProvider,
  ) {}

  get mode(): 'mock' | 'live' {
    return this.config.get<string>('ROUTING_PROVIDER_MODE') === 'live' ? 'live' : 'mock';
  }

  planningEstimate(origin: GeoPoint | null, destination: GeoPoint | null): RouteLegEstimate {
    return this.distanceFallback.planningEstimate(origin, destination);
  }

  async measureLeg(
    origin: GeoPoint | null,
    destination: GeoPoint | null,
    requestedMode: RequestedTransportMode,
    options?: MeasureLegOptions,
  ): Promise<RouteLegEstimate> {
    switch (requestedMode) {
      case 'taxi':
        return this.naverTaxiProvider.measureLeg(origin, destination, requestedMode);
      case 'subway':
        return this.measureSubwayOrShortWalk(origin, destination, requestedMode, options);
      case 'bus':
        return this.seoulBusProvider.measureLeg(origin, destination, requestedMode);
      case 'walk':
      default:
        return this.distanceFallback.measureLeg(origin, destination, requestedMode);
    }
  }

  private async measureSubwayOrShortWalk(
    origin: GeoPoint | null,
    destination: GeoPoint | null,
    requestedMode: RequestedTransportMode,
    options?: MeasureLegOptions,
  ): Promise<RouteLegEstimate> {
    const walking = this.distanceFallback.planningEstimate(origin, destination);
    const subway = await this.seoulSubwayProvider.measureLeg(
      origin,
      destination,
      requestedMode,
      options,
    );
    if (subway.transportMode === 'walk' || options?.allowShortWalkSubstitution === false) {
      return subway;
    }

    const maxWalkMeters = this.config.get<number>('ROUTING_SHORT_WALK_MAX_METERS') ?? 1_000;
    const minimumSavingsMinutes =
      this.config.get<number>('ROUTING_SHORT_WALK_MIN_SAVINGS_MINUTES') ?? 3;
    const withinDistance =
      walking.distanceKm !== null && walking.distanceKm * 1_000 <= maxWalkMeters;
    const withinUserLimit =
      options?.maxWalkMinutes === null || options?.maxWalkMinutes === undefined
        ? true
        : walking.durationMinutes <= options.maxWalkMinutes;
    const meaningfullyFaster =
      walking.durationMinutes + minimumSavingsMinutes <= subway.durationMinutes;
    if (!withinDistance || !withinUserLimit || !meaningfullyFaster) return subway;

    return {
      ...walking,
      requestedTransportMode: requestedMode,
      disclaimer: `지하철 우선 요청이지만 약 ${Math.round((walking.distanceKm ?? 0) * 1_000)}m 근거리이며, 도보 추정 ${walking.durationMinutes}분이 지하철 총 ${subway.durationMinutes}분보다 짧아 도보를 선택했습니다. 실제 보행 경로가 아닌 직선거리 기반 추정값입니다.`,
    };
  }
}
