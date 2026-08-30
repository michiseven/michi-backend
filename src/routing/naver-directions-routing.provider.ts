import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GeoPoint } from '../database/entities';
import { DistanceBasedRoutingProvider } from './distance-based-routing.provider';
import type { RequestedTransportMode, RouteLegEstimate, RoutingProvider } from './routing-provider';

interface NaverDirectionsResponse {
  code?: number;
  message?: string;
  currentDateTime?: string;
  route?: {
    traoptimal?: Array<{
      summary?: { distance?: number; duration?: number };
      path?: Array<[number, number]>;
    }>;
  };
}

@Injectable()
export class NaverDirectionsRoutingProvider implements RoutingProvider {
  readonly name = 'naver-directions-driving-v1';
  readonly mode = 'live' as const;

  constructor(
    private readonly config: ConfigService,
    private readonly fallback: DistanceBasedRoutingProvider,
  ) {}

  planningEstimate(origin: GeoPoint | null, destination: GeoPoint | null): RouteLegEstimate {
    return this.fallback.planningEstimate(origin, destination);
  }

  async measureLeg(
    origin: GeoPoint | null,
    destination: GeoPoint | null,
    requestedMode: RequestedTransportMode,
  ): Promise<RouteLegEstimate> {
    const estimate = this.fallback.planningEstimate(origin, destination);
    if (requestedMode !== 'taxi') {
      return {
        ...estimate,
        requestedTransportMode: requestedMode,
        disclaimer:
          requestedMode === 'subway' || requestedMode === 'bus'
            ? '현재 연결된 NAVER Directions는 자동차 전용입니다. 대중교통 실측으로 표시하지 않고 보행 추정값을 사용했습니다.'
            : estimate.disclaimer,
      };
    }
    if (!origin || !destination) {
      return { ...estimate, requestedTransportMode: requestedMode };
    }

    const endpoint = this.config.getOrThrow<string>('NAVER_DIRECTIONS_URL');
    const url = new URL(`${endpoint.replace(/\/$/u, '')}/driving`);
    url.searchParams.set('start', `${origin.coordinates[0]},${origin.coordinates[1]}`);
    url.searchParams.set('goal', `${destination.coordinates[0]},${destination.coordinates[1]}`);
    url.searchParams.set('option', 'traoptimal');
    url.searchParams.set('lang', 'ja');

    const response = await fetch(url, {
      headers: {
        'x-ncp-apigw-api-key-id': this.config.getOrThrow<string>('NAVER_MAPS_API_KEY_ID'),
        'x-ncp-apigw-api-key': this.config.getOrThrow<string>('NAVER_MAPS_API_KEY'),
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new ServiceUnavailableException({
        code: 'NAVER_DIRECTIONS_REQUEST_FAILED',
        message: `NAVER Directions 요청이 HTTP ${response.status}로 실패했습니다.`,
      });
    }
    const body = (await response.json()) as NaverDirectionsResponse;
    const route = body.route?.traoptimal?.[0];
    const distanceMeters = route?.summary?.distance;
    const durationMs = route?.summary?.duration;
    if (!route || body.code !== 0 || distanceMeters === undefined || durationMs === undefined) {
      throw new ServiceUnavailableException({
        code: 'NAVER_DIRECTIONS_ROUTE_UNAVAILABLE',
        message: body.message ?? 'NAVER Directions에서 유효한 자동차 경로를 반환하지 않았습니다.',
      });
    }
    return {
      distanceKm: distanceMeters / 1_000,
      durationMinutes: Math.max(1, Math.ceil(durationMs / 60_000)),
      method: 'naver-directions-driving',
      evidence: 'measured',
      transportMode: 'car',
      requestedTransportMode: requestedMode,
      measuredAt: body.currentDateTime ?? new Date().toISOString(),
      path: route.path,
      disclaimer:
        'NAVER Directions의 실시간 교통 기반 자동차 경로입니다. 도보·대중교통 경로가 아닙니다.',
    };
  }
}
