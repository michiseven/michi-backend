import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GeoPoint } from '../database/entities';
import { coordinatesOf, haversineDistanceKm } from '../recommendation/geo';
import { TransitStationService } from '../transit/transit-station.service';
import { DistanceBasedRoutingProvider } from './distance-based-routing.provider';
import type {
  MeasureLegOptions,
  RequestedTransportMode,
  RouteLegEstimate,
  RoutingProvider,
  SubwayLegDetails,
} from './routing-provider';

const WALKING_SPEED_KMH = 4.5;
const MIN_WALK_MINUTES = 1;

interface SeoulSubwayPathStation {
  stnCd?: string;
  stnNm?: string;
  lineNm?: string;
}

interface SeoulSubwayPath {
  dptreStn?: SeoulSubwayPathStation;
  arvlStn?: SeoulSubwayPathStation;
  stnSctnDstc?: number;
  reqHr?: number;
  trsitYn?: 'Y' | 'N';
}

interface SeoulSubwayApiResponse {
  header?: { resultCode?: string; resultMsg?: string };
  body?: {
    searchType?: 'duration' | 'distance' | 'transfer';
    totalDstc?: number;
    totalReqHr?: number;
    totalCardCrg?: number;
    trsitNmtm?: number;
    paths?: SeoulSubwayPath[];
  };
}

export function subwayApiStationNameCandidates(stationName: string): string[] {
  const normalized = stationName.normalize('NFKC').trim().replace(/역$/u, '');
  const withoutParenthetical = normalized.replace(/\s*\([^)]*\)\s*/gu, '').trim();
  const parentheticalAliases = [...normalized.matchAll(/\(([^)]+)\)/gu)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set([normalized, withoutParenthetical, ...parentheticalAliases])].filter(Boolean);
}

@Injectable()
export class SeoulSubwayRoutingProvider implements RoutingProvider {
  readonly name = 'seoul-subway-path-v1';
  private readonly logger = new Logger(SeoulSubwayRoutingProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly transitStationService: TransitStationService,
    private readonly fallback: DistanceBasedRoutingProvider,
  ) {}

  get mode(): 'mock' | 'live' {
    return this.config.get<string>('SEOUL_SUBWAY_PROVIDER_MODE') === 'live' ? 'live' : 'mock';
  }

  planningEstimate(origin: GeoPoint | null, destination: GeoPoint | null): RouteLegEstimate {
    return this.fallback.planningEstimate(origin, destination);
  }

  async measureLeg(
    origin: GeoPoint | null,
    destination: GeoPoint | null,
    requestedMode: RequestedTransportMode,
    options?: MeasureLegOptions,
  ): Promise<RouteLegEstimate> {
    const defaultEstimate = this.fallback.planningEstimate(origin, destination);
    if (!origin || !destination) {
      return { ...defaultEstimate, requestedTransportMode: requestedMode };
    }

    const originCoords = coordinatesOf(origin);
    const destCoords = coordinatesOf(destination);
    if (!originCoords || !destCoords) {
      return { ...defaultEstimate, requestedTransportMode: requestedMode };
    }

    const maxAccessMeters = Number(
      this.config.get<number>('SEOUL_SUBWAY_MAX_ACCESS_METERS') ?? 1500,
    );

    // 1. Find nearest subway stations
    const originStationResult = await this.transitStationService.findNearestStation(
      origin,
      maxAccessMeters,
    );
    const destStationResult = await this.transitStationService.findNearestStation(
      destination,
      maxAccessMeters,
    );

    if (!originStationResult || !destStationResult) {
      return {
        ...defaultEstimate,
        requestedTransportMode: requestedMode,
        disclaimer: '출발지 또는 목적지 반경 내 지하철역을 찾지 못해 보행 추정값을 사용했습니다.',
      };
    }

    const departureStation = originStationResult.station;
    const arrivalStation = destStationResult.station;

    // 2. If origin and destination stations are the same station
    if (departureStation.stationName === arrivalStation.stationName) {
      return {
        ...defaultEstimate,
        requestedTransportMode: requestedMode,
        disclaimer: `출발지와 목적지가 동일한 ${departureStation.stationName}역 인근에 위치하여 보행 추정값을 사용했습니다.`,
      };
    }

    // Calculate access and egress walking estimates
    const accessWalkDistanceKm = originStationResult.distanceMeters / 1000;
    const accessWalkMinutes = Math.max(
      MIN_WALK_MINUTES,
      Math.ceil((accessWalkDistanceKm / WALKING_SPEED_KMH) * 60),
    );

    const egressWalkDistanceKm = destStationResult.distanceMeters / 1000;
    const egressWalkMinutes = Math.max(
      MIN_WALK_MINUTES,
      Math.ceil((egressWalkDistanceKm / WALKING_SPEED_KMH) * 60),
    );

    // Mock is always estimated. It must never claim an official fare or measured timestamp.
    if (this.mode === 'mock') {
      const mockStationDistKm = haversineDistanceKm(
        {
          longitude: originStationResult.station.location.coordinates[0],
          latitude: originStationResult.station.location.coordinates[1],
        },
        {
          longitude: destStationResult.station.location.coordinates[0],
          latitude: destStationResult.station.location.coordinates[1],
        },
      );
      const mockSubwayMinutes = Math.max(4, Math.round(mockStationDistKm * 2.5));
      const totalMinutes = accessWalkMinutes + mockSubwayMinutes + egressWalkMinutes;
      const totalDistanceKm = Number(
        (accessWalkDistanceKm + mockStationDistKm + egressWalkDistanceKm).toFixed(2),
      );

      const subwayDetails: SubwayLegDetails = {
        departureStation: departureStation.stationName,
        departureStationLine: departureStation.line,
        arrivalStation: arrivalStation.stationName,
        arrivalStationLine: arrivalStation.line,
        subwayDurationMinutes: mockSubwayMinutes,
        subwayDistanceKm: Number(mockStationDistKm.toFixed(2)),
        fareKrw: null,
        transferCount: 0,
        pathSummary: `${departureStation.stationName} -> ${arrivalStation.stationName}`,
        accessWalkMinutes,
        accessWalkDistanceKm: Number(accessWalkDistanceKm.toFixed(2)),
        egressWalkMinutes,
        egressWalkDistanceKm: Number(egressWalkDistanceKm.toFixed(2)),
      };

      return {
        distanceKm: totalDistanceKm,
        durationMinutes: totalMinutes,
        method: 'seoul-subway-estimate-v1',
        evidence: 'estimated',
        transportMode: 'subway',
        requestedTransportMode: requestedMode,
        subwayDetails,
        disclaimer:
          'Mock 모드로 계산된 지하철 경로입니다. 역까지의 도보 구간은 직선거리 기반 추정치입니다.',
      };
    }

    // 4. Live API Call: OA-22724 getShtrmPath
    const baseUrl = (
      this.config.get<string>('SEOUL_SUBWAY_API_BASE_URL') ?? 'http://openapi.seoul.go.kr:8088'
    ).replace(/\/$/u, '');
    const apiKey = this.config.getOrThrow<string>('SEOUL_OPEN_DATA_API_KEY');
    const searchType =
      this.config.get<'duration' | 'distance' | 'transfer'>('SEOUL_SUBWAY_SEARCH_TYPE') ??
      'duration';
    const searchDateTime = this.searchDateTime(options);

    const departureNames = subwayApiStationNameCandidates(departureStation.stationName);
    const arrivalNames = subwayApiStationNameCandidates(arrivalStation.stationName);
    let responseBody: SeoulSubwayApiResponse | null = null;
    let lastRouteError = '경로를 찾을 수 없습니다.';

    routeLookup: for (const departureName of departureNames) {
      for (const arrivalName of arrivalNames) {
        const startParam = encodeURIComponent(departureName);
        const endParam = encodeURIComponent(arrivalName);
        const url = `${baseUrl}/${encodeURIComponent(apiKey)}/json/getShtrmPath/1/1000/${startParam}/${endParam}/${encodeURIComponent(searchDateTime)}/${searchType}`;

        let response: Response;
        try {
          response = await fetch(url, {
            signal: AbortSignal.timeout(5_000),
          });
        } catch (err) {
          this.logger.warn(
            `Subway API request timeout or network failure: ${err instanceof Error ? err.name : 'unknown error'}`,
          );
          throw new ServiceUnavailableException({
            code: 'SEOUL_SUBWAY_REQUEST_FAILED',
            message: '서울시 지하철 최단경로 API 호출에 실패했습니다.',
          });
        }

        if (!response.ok) {
          throw new ServiceUnavailableException({
            code: 'SEOUL_SUBWAY_HTTP_ERROR',
            message: `서울시 지하철 API가 HTTP ${response.status}를 반환했습니다.`,
          });
        }

        try {
          responseBody = (await response.json()) as SeoulSubwayApiResponse;
        } catch {
          throw new ServiceUnavailableException({
            code: 'SEOUL_SUBWAY_INVALID_RESPONSE',
            message: '서울시 지하철 API가 JSON이 아닌 응답을 반환했습니다.',
          });
        }
        if (responseBody.header?.resultCode === '00') break routeLookup;

        lastRouteError = responseBody.header?.resultMsg ?? lastRouteError;
        const stationNameMismatch = /출발역명|도착역명|역명.*존재하지/iu.test(lastRouteError);
        if (!stationNameMismatch) break routeLookup;
      }
    }

    if (!responseBody || responseBody.header?.resultCode !== '00') {
      throw new ServiceUnavailableException({
        code: 'SEOUL_SUBWAY_ROUTE_UNAVAILABLE',
        message: `서울시 지하철 경로 조회 실패: ${lastRouteError}`,
      });
    }
    const official = responseBody.body;
    const paths = official?.paths ?? [];
    const totalDurationSeconds = Number(official?.totalReqHr);
    const totalDistanceMeters = Number(official?.totalDstc);
    if (
      !official ||
      paths.length === 0 ||
      !Number.isFinite(totalDurationSeconds) ||
      !Number.isFinite(totalDistanceMeters)
    ) {
      throw new ServiceUnavailableException({
        code: 'SEOUL_SUBWAY_EMPTY_RESULT',
        message: '서울시 지하철 최단경로 결과가 비어 있습니다.',
      });
    }
    const subwayDurationMinutes = Math.max(1, Math.ceil(totalDurationSeconds / 60));
    const subwayDistanceKm = Number((totalDistanceMeters / 1000).toFixed(3));
    const fareValue = Number(official.totalCardCrg);
    const fareKrw = Number.isFinite(fareValue) ? Math.round(fareValue) : null;
    const transferValue = Number(official.trsitNmtm);
    const transferCount = Number.isFinite(transferValue) ? Math.round(transferValue) : 0;
    const pathStations = paths
      .flatMap((path, index) =>
        index === 0 ? [path.dptreStn?.stnNm, path.arvlStn?.stnNm] : [path.arvlStn?.stnNm],
      )
      .filter((name): name is string => Boolean(name));

    const totalMinutes = accessWalkMinutes + subwayDurationMinutes + egressWalkMinutes;
    const totalDistanceKm = Number(
      (accessWalkDistanceKm + (subwayDistanceKm ?? 0) + egressWalkDistanceKm).toFixed(2),
    );

    const subwayDetails: SubwayLegDetails = {
      departureStation: departureStation.stationName,
      departureStationLine: departureStation.line,
      arrivalStation: arrivalStation.stationName,
      arrivalStationLine: arrivalStation.line,
      subwayDurationMinutes,
      subwayDistanceKm,
      fareKrw,
      transferCount,
      pathSummary:
        pathStations.join(' → ') ||
        `${departureStation.stationName} → ${arrivalStation.stationName}`,
      accessWalkMinutes,
      accessWalkDistanceKm: Number(accessWalkDistanceKm.toFixed(2)),
      egressWalkMinutes,
      egressWalkDistanceKm: Number(egressWalkDistanceKm.toFixed(2)),
      segments: paths.map((path) => ({
        departureStation: path.dptreStn?.stnNm ?? '미확인',
        arrivalStation: path.arvlStn?.stnNm ?? '미확인',
        line: path.dptreStn?.lineNm ?? null,
        durationMinutes: Math.max(0, Math.ceil(Number(path.reqHr ?? 0) / 60)),
        distanceKm: Number((Number(path.stnSctnDstc ?? 0) / 1000).toFixed(3)),
        transfer: path.trsitYn === 'Y',
      })),
    };

    return {
      distanceKm: totalDistanceKm,
      durationMinutes: totalMinutes,
      method: 'seoul-subway-path-v1',
      evidence: 'mixed',
      transportMode: 'subway',
      requestedTransportMode: requestedMode,
      measuredAt: new Date().toISOString(),
      subwayDetails,
      disclaimer:
        '지하철 구간은 서울교통공사 공식 경로이며, 역까지의 도보 구간은 직선거리 기반 추정치입니다.',
    };
  }

  private searchDateTime(options?: MeasureLegOptions): string {
    const departure = options?.departureTime;
    if (departure?.includes('T')) {
      const parsed = new Date(departure);
      if (!Number.isNaN(parsed.getTime())) return this.formatSeoulDateTime(parsed);
    }
    const date = options?.travelDate;
    if (date && /^\d{4}-\d{2}-\d{2}$/u.test(date) && departure && /^\d{2}:\d{2}/u.test(departure)) {
      return `${date} ${departure.slice(0, 5)}:00`;
    }
    return this.formatSeoulDateTime(new Date());
  }

  private formatSeoulDateTime(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? '00';
    return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}:${value('second')}`;
  }
}
