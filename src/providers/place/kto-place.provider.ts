import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ProviderPlaceRecord } from './place-provider';

export const KTO_PLACE_SOURCE = 'kto-tour-jpn';
export const KTO_DATASET_URL = 'https://www.data.go.kr/data/15101760/openapi.do';
const SEOUL_AREA_CODE = '1';

export interface KtoTourItem {
  contentid?: unknown;
  contenttypeid?: unknown;
  title?: unknown;
  addr1?: unknown;
  addr2?: unknown;
  mapx?: unknown;
  mapy?: unknown;
  areacode?: unknown;
  sigungucode?: unknown;
  cat1?: unknown;
  cat2?: unknown;
  cat3?: unknown;
  firstimage?: unknown;
  firstimage2?: unknown;
  modifiedtime?: unknown;
  tel?: unknown;
  [key: string]: unknown;
}

export interface KtoSeoulPage {
  pageNo: number;
  numOfRows: number;
  totalCount: number;
  places: ProviderPlaceRecord[];
  rejectedCount: number;
}

interface KtoApiEnvelope {
  response?: {
    header?: { resultCode?: unknown; resultMsg?: unknown };
    body?: {
      pageNo?: unknown;
      numOfRows?: unknown;
      totalCount?: unknown;
      items?: { item?: unknown } | '';
    };
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function scalarString(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function coordinate(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return null;
  return parsed >= min && parsed <= max ? parsed : null;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toItemArray(value: unknown): KtoTourItem[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is KtoTourItem => typeof item === 'object' && item !== null);
  }
  return typeof value === 'object' && value !== null ? [value as KtoTourItem] : [];
}

export function normalizeKtoTourItem(item: KtoTourItem): ProviderPlaceRecord | null {
  const contentId = optionalString(item.contentid);
  const name = optionalString(item.title);
  if (!contentId || !name || optionalString(item.areacode) !== SEOUL_AREA_CODE) {
    return null;
  }
  const longitude = coordinate(item.mapx, 124, 132);
  const latitude = coordinate(item.mapy, 33, 39);

  const addressParts = [optionalString(item.addr1), optionalString(item.addr2)].filter(
    (part): part is string => part !== null,
  );
  const contentTypeId = optionalString(item.contenttypeid);
  const categoryCodes = [item.cat1, item.cat2, item.cat3]
    .map(optionalString)
    .filter((part): part is string => part !== null);

  return {
    provider: KTO_PLACE_SOURCE,
    providerMode: 'live',
    sourcePlaceId: contentId,
    sourcePlaceIdKind: 'provider',
    name,
    rawCategory: ['kto', contentTypeId, ...categoryCodes].filter(Boolean).join(':'),
    address: addressParts.length > 0 ? addressParts.join(' ') : null,
    roadAddress: null,
    longitude,
    latitude,
    rawPayload: {
      ...item,
      michiSourceMetadata: {
        sourceName: '한국관광공사 일문 관광정보서비스_GW',
        sourceUrl: KTO_DATASET_URL,
        imageFields: ['firstimage', 'firstimage2'],
        usageNote: '공공데이터포털 이용조건과 개별 이미지 메타데이터를 함께 확인해야 합니다.',
      },
    },
  };
}

@Injectable()
export class KtoPlaceProvider {
  readonly name = KTO_PLACE_SOURCE;

  get mode(): 'mock' | 'live' {
    return this.config.getOrThrow<'mock' | 'live'>('KTO_PROVIDER_MODE');
  }

  constructor(private readonly config: ConfigService) {}

  async fetchSeoulPage(pageNo: number, numOfRows: number): Promise<KtoSeoulPage> {
    if (this.mode !== 'live') {
      throw new Error('KTO synchronization requires KTO_PROVIDER_MODE=live');
    }
    if (
      !Number.isInteger(pageNo) ||
      pageNo <= 0 ||
      !Number.isInteger(numOfRows) ||
      numOfRows <= 0
    ) {
      throw new Error('KTO pageNo and numOfRows must be positive integers');
    }
    const serviceKey = this.config.get<string>('KTO_TOUR_API_KEY')?.trim();
    if (!serviceKey) throw new Error('KTO_TOUR_API_KEY is required for KTO synchronization');

    const baseUrl = this.config.getOrThrow<string>('KTO_TOUR_API_BASE_URL').replace(/\/$/, '');
    const url = new URL(`${baseUrl}/areaBasedList2`);
    url.searchParams.set('serviceKey', this.decodePortalKey(serviceKey));
    url.searchParams.set('MobileOS', 'ETC');
    url.searchParams.set('MobileApp', this.config.getOrThrow<string>('KTO_MOBILE_APP'));
    url.searchParams.set('_type', 'json');
    url.searchParams.set('areaCode', SEOUL_AREA_CODE);
    url.searchParams.set('arrange', 'A');
    url.searchParams.set('pageNo', String(pageNo));
    url.searchParams.set('numOfRows', String(numOfRows));

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (networkError: unknown) {
      const cause =
        networkError && typeof networkError === 'object' && 'cause' in networkError
          ? String(networkError.cause)
          : '';
      const message = networkError instanceof Error ? networkError.message : String(networkError);
      throw new BadGatewayException({
        code: 'KTO_NETWORK_ERROR',
        message: `KTO TourAPI network request failed: ${message}${cause ? ` (${cause})` : ''}`,
      });
    }
    if (!response.ok) {
      throw new BadGatewayException({
        code: 'KTO_API_ERROR',
        message: `KTO TourAPI request failed with ${response.status}`,
      });
    }
    let payload: KtoApiEnvelope;
    try {
      payload = (await response.json()) as KtoApiEnvelope;
    } catch {
      throw new BadGatewayException({
        code: 'KTO_INVALID_RESPONSE',
        message: 'KTO TourAPI returned a non-JSON response',
      });
    }
    const header = payload.response?.header;
    if (scalarString(header?.resultCode) !== '0000') {
      throw new BadGatewayException({
        code: 'KTO_API_ERROR',
        message: `KTO TourAPI error: ${scalarString(header?.resultMsg) ?? 'unknown error'}`,
      });
    }
    const body = payload.response?.body;
    if (!body || typeof body !== 'object') {
      throw new BadGatewayException({
        code: 'KTO_INVALID_RESPONSE',
        message: 'KTO TourAPI returned an invalid response body',
      });
    }
    const rawItems = toItemArray(typeof body.items === 'object' ? body.items.item : undefined);
    const normalized = rawItems.map(normalizeKtoTourItem);
    return {
      pageNo: positiveNumber(body.pageNo, pageNo),
      numOfRows: positiveNumber(body.numOfRows, numOfRows),
      totalCount: positiveNumber(body.totalCount, 0),
      places: normalized.filter((place): place is ProviderPlaceRecord => place !== null),
      rejectedCount: normalized.filter((place) => place === null).length,
    };
  }

  private decodePortalKey(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
}
