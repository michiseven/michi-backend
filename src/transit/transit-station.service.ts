import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransitStation, type GeoPoint } from '../database/entities';
import { coordinatesOf } from '../recommendation/geo';

const SEOUL_SUBWAY_SOURCE = 'seoul-oa-21232';
const SEOUL_BUS_SOURCE = 'seoul-oa-21231';
const SEOUL_SUBWAY_SOURCE_URL = 'https://data.seoul.go.kr/dataList/OA-21232/A/1/datasetView.do';
const SEOUL_BUS_SOURCE_URL = 'https://data.seoul.go.kr/dataList/OA-21231/A/1/datasetView.do';
const PAGE_SIZE = 1000;

export interface NearestStationResult {
  station: TransitStation;
  distanceMeters: number;
}

export interface TransitSyncSummary {
  subway: TransitSyncCounts;
  bus: TransitSyncCounts;
}

interface TransitSyncCounts {
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
}

interface SeoulDatasetEnvelope<T> {
  list_total_count?: number;
  RESULT?: { CODE?: string; MESSAGE?: string };
  row?: T[];
}

interface SubwayStationRow {
  BLDN_ID?: string;
  BLDN_NM?: string;
  ROUTE?: string;
  LAT?: string | number;
  LOT?: string | number;
}

interface BusStationRow {
  CRTR_ID?: string;
  CRTR_NM?: string;
  CRTR_TYPE?: string;
  CRTR_NO?: string;
  LAT?: string | number;
  LOT?: string | number;
  BUS_ARVL_INFO_GUIDEM_INSTL?: string;
}

interface RawStationQueryResult {
  id: string;
  source: string;
  transportMode: 'subway' | 'bus';
  stationCode: string;
  stationName: string;
  line: string;
  district: string | null;
  location: GeoPoint;
  sourceUrl: string | null;
  rawMetadata: Record<string, string | number | boolean | null>;
  distance_meters: string | number;
}

@Injectable()
export class TransitStationService {
  constructor(
    @InjectRepository(TransitStation)
    private readonly stationRepo: Repository<TransitStation>,
    private readonly config: ConfigService,
  ) {}

  async syncOfficialStations(): Promise<TransitSyncSummary> {
    const subwayService =
      this.config.get<string>('SEOUL_SUBWAY_STATION_SERVICE') ?? 'subwayStationMaster';
    const busService = this.config.get<string>('SEOUL_BUS_STATION_SERVICE') ?? 'tbisMasterStation';
    const [subwayRows, busRows] = await Promise.all([
      this.fetchDataset<SubwayStationRow>(subwayService),
      this.fetchDataset<BusStationRow>(busService),
    ]);

    const subway = await this.persistRows(
      subwayRows,
      'subway',
      SEOUL_SUBWAY_SOURCE,
      SEOUL_SUBWAY_SOURCE_URL,
      (row) => ({
        stationCode: row.BLDN_ID,
        stationName: row.BLDN_NM,
        line: row.ROUTE,
        latitude: row.LAT,
        longitude: row.LOT,
        rawMetadata: {},
      }),
    );
    const bus = await this.persistRows(
      busRows,
      'bus',
      SEOUL_BUS_SOURCE,
      SEOUL_BUS_SOURCE_URL,
      (row) => ({
        stationCode: row.CRTR_ID,
        stationName: row.CRTR_NM,
        line: 'bus-stop',
        latitude: row.LAT,
        longitude: row.LOT,
        rawMetadata: {
          arsId: row.CRTR_NO?.trim() || null,
          stationType: row.CRTR_TYPE?.trim() || null,
          arrivalDisplayInstalled: row.BUS_ARVL_INFO_GUIDEM_INSTL?.trim() || null,
        },
      }),
    );
    return { subway, bus };
  }

  async findNearestStation(
    point: GeoPoint | null,
    maxDistanceMeters = 1500,
  ): Promise<NearestStationResult | null> {
    const stations = await this.findNearby(point, 'subway', maxDistanceMeters, 1);
    return stations[0] ?? null;
  }

  async findNearbyBusStops(
    point: GeoPoint | null,
    maxDistanceMeters = 500,
    limit = 10,
  ): Promise<NearestStationResult[]> {
    return this.findNearby(point, 'bus', maxDistanceMeters, limit);
  }

  private async findNearby(
    point: GeoPoint | null,
    mode: 'subway' | 'bus',
    maxDistanceMeters: number,
    limit: number,
  ): Promise<NearestStationResult[]> {
    const coords = coordinatesOf(point);
    if (!coords) return [];
    const raw = await this.stationRepo
      .createQueryBuilder('s')
      .select('s.id', 'id')
      .addSelect('s.source', 'source')
      .addSelect('s.transport_mode', 'transportMode')
      .addSelect('s.station_code', 'stationCode')
      .addSelect('s.station_name', 'stationName')
      .addSelect('s.line', 'line')
      .addSelect('s.district', 'district')
      .addSelect('ST_AsGeoJSON(s.location)::json', 'location')
      .addSelect('s.source_url', 'sourceUrl')
      .addSelect('s.raw_metadata', 'rawMetadata')
      .addSelect(
        'ST_Distance(s.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography)',
        'distance_meters',
      )
      .where('s.transport_mode = :mode', { mode })
      .andWhere(
        'ST_DWithin(s.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :maxDistance)',
        {
          lng: coords.longitude,
          lat: coords.latitude,
          maxDistance: maxDistanceMeters,
        },
      )
      .orderBy('distance_meters', 'ASC')
      .limit(limit)
      .getRawMany<RawStationQueryResult>();

    return raw.map((item) => {
      const station = this.stationRepo.create({
        id: item.id,
        source: item.source,
        transportMode: item.transportMode,
        stationCode: item.stationCode,
        stationName: item.stationName,
        line: item.line,
        district: item.district,
        location: item.location,
        sourceUrl: item.sourceUrl,
        rawMetadata: item.rawMetadata,
      });
      return { station, distanceMeters: Math.round(Number(item.distance_meters)) };
    });
  }

  private async fetchDataset<T>(service: string): Promise<T[]> {
    const baseUrl = (
      this.config.get<string>('SEOUL_SUBWAY_API_BASE_URL') ?? 'http://openapi.seoul.go.kr:8088'
    ).replace(/\/$/u, '');
    const apiKey = this.config.getOrThrow<string>('SEOUL_OPEN_DATA_API_KEY');
    const rows: T[] = [];
    let total = Number.POSITIVE_INFINITY;

    for (let start = 1; start <= total; start += PAGE_SIZE) {
      const end = start + PAGE_SIZE - 1;
      const url = `${baseUrl}/${encodeURIComponent(apiKey)}/json/${encodeURIComponent(service)}/${start}/${end}/`;
      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      } catch {
        throw new ServiceUnavailableException({
          code: 'SEOUL_TRANSIT_STATION_REQUEST_FAILED',
          message: `${service} 공식 데이터 호출에 실패했습니다.`,
        });
      }
      if (!response.ok) {
        throw new ServiceUnavailableException({
          code: 'SEOUL_TRANSIT_STATION_HTTP_ERROR',
          message: `${service}가 HTTP ${response.status}를 반환했습니다.`,
        });
      }
      const body = (await response.json()) as Record<string, SeoulDatasetEnvelope<T>>;
      const envelope = body[service];
      if (!envelope || envelope.RESULT?.CODE !== 'INFO-000') {
        throw new ServiceUnavailableException({
          code: 'SEOUL_TRANSIT_STATION_INVALID_RESPONSE',
          message: envelope?.RESULT?.MESSAGE ?? `${service} 응답 계약이 올바르지 않습니다.`,
        });
      }
      total = Number(envelope.list_total_count ?? 0);
      rows.push(...(envelope.row ?? []));
      if ((envelope.row?.length ?? 0) === 0) break;
    }
    return rows;
  }

  private async persistRows<T>(
    rows: T[],
    transportMode: 'subway' | 'bus',
    source: string,
    sourceUrl: string,
    normalize: (row: T) => {
      stationCode?: string;
      stationName?: string;
      line?: string;
      latitude?: string | number;
      longitude?: string | number;
      rawMetadata: Record<string, string | number | boolean | null>;
    },
  ): Promise<TransitSyncCounts> {
    const existing = await this.stationRepo.find({ where: { source } });
    const existingByKey = new Map(
      existing.map((item) => [`${item.stationCode}:${item.line}`, item]),
    );
    const entities: TransitStation[] = [];
    let rejected = 0;
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const raw of rows) {
      const item = normalize(raw);
      const latitude = Number(item.latitude);
      const longitude = Number(item.longitude);
      if (
        !item.stationCode?.trim() ||
        !item.stationName?.trim() ||
        !item.line?.trim() ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < 36 ||
        latitude > 39 ||
        longitude < 125 ||
        longitude > 130
      ) {
        rejected += 1;
        continue;
      }
      const key = `${item.stationCode.trim()}:${item.line.trim()}`;
      const previous = existingByKey.get(key);
      const next = {
        source,
        transportMode,
        stationCode: item.stationCode.trim(),
        stationName: item.stationName.trim(),
        line: item.line.trim(),
        district: null,
        location: { type: 'Point', coordinates: [longitude, latitude] } satisfies GeoPoint,
        sourceUrl,
        rawMetadata: item.rawMetadata,
      };
      if (previous && this.sameStation(previous, next)) {
        unchanged += 1;
        continue;
      }
      entities.push(this.stationRepo.create(next));
      if (previous) updated += 1;
      else inserted += 1;
    }
    for (let index = 0; index < entities.length; index += 500) {
      await this.stationRepo.upsert(entities.slice(index, index + 500), {
        conflictPaths: ['source', 'stationCode', 'line'],
        skipUpdateIfNoValuesChanged: true,
      });
    }
    return { fetched: rows.length, inserted, updated, unchanged, rejected };
  }

  private sameStation(
    previous: TransitStation,
    next: Pick<
      TransitStation,
      | 'source'
      | 'transportMode'
      | 'stationCode'
      | 'stationName'
      | 'line'
      | 'district'
      | 'location'
      | 'sourceUrl'
      | 'rawMetadata'
    >,
  ): boolean {
    return (
      previous.source === next.source &&
      previous.transportMode === next.transportMode &&
      previous.stationCode === next.stationCode &&
      previous.stationName === next.stationName &&
      previous.line === next.line &&
      previous.district === next.district &&
      Math.abs(Number(previous.location.coordinates[0]) - Number(next.location.coordinates[0])) <
        0.0000001 &&
      Math.abs(Number(previous.location.coordinates[1]) - Number(next.location.coordinates[1])) <
        0.0000001 &&
      previous.sourceUrl === next.sourceUrl &&
      this.canonicalJson(previous.rawMetadata) === this.canonicalJson(next.rawMetadata)
    );
  }

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.canonicalJson(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
  }
}
