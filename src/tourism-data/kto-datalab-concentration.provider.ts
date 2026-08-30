import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const KTO_DATALAB_CONCENTRATION_DATASET_URL =
  'https://www.data.go.kr/data/15128555/openapi.do';
export const KTO_DATALAB_CONCENTRATION_DATASET_KEY = 'kto-datalab-tourism-concentration-forecast';
const SEOUL_AREA_CODE = '11';

export const SEOUL_DATALAB_DISTRICTS = Object.freeze([
  { code: '11110', name: '종로구' },
  { code: '11140', name: '중구' },
  { code: '11170', name: '용산구' },
  { code: '11200', name: '성동구' },
  { code: '11215', name: '광진구' },
  { code: '11230', name: '동대문구' },
  { code: '11260', name: '중랑구' },
  { code: '11290', name: '성북구' },
  { code: '11305', name: '강북구' },
  { code: '11320', name: '도봉구' },
  { code: '11350', name: '노원구' },
  { code: '11380', name: '은평구' },
  { code: '11410', name: '서대문구' },
  { code: '11440', name: '마포구' },
  { code: '11470', name: '양천구' },
  { code: '11500', name: '강서구' },
  { code: '11530', name: '구로구' },
  { code: '11545', name: '금천구' },
  { code: '11560', name: '영등포구' },
  { code: '11590', name: '동작구' },
  { code: '11620', name: '관악구' },
  { code: '11650', name: '서초구' },
  { code: '11680', name: '강남구' },
  { code: '11710', name: '송파구' },
  { code: '11740', name: '강동구' },
] as const);

export type SeoulDataLabDistrict = (typeof SEOUL_DATALAB_DISTRICTS)[number];

interface KtoDataLabItem {
  cnctrRate?: unknown;
  baseYmd?: unknown;
  areaCd?: unknown;
  areaNm?: unknown;
  signguCd?: unknown;
  signguNm?: unknown;
  tAtsNm?: unknown;
}

interface KtoDataLabEnvelope {
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

export interface KtoConcentrationForecast {
  areaCode: string;
  areaName: string;
  districtCode: string;
  districtName: string;
  attractionName: string;
  forecastDate: string;
  concentrationIndex: number;
}

export interface KtoConcentrationDistrictResult {
  district: SeoulDataLabDistrict;
  totalAvailable: number;
  pages: number;
  records: KtoConcentrationForecast[];
  rejectedCount: number;
}

function scalar(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function itemArray(value: unknown): KtoDataLabItem[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is KtoDataLabItem => typeof item === 'object' && item !== null,
    );
  }
  return typeof value === 'object' && value !== null ? [value] : [];
}

function isoDate(value: unknown): string | null {
  const raw = scalar(value);
  if (!raw || !/^\d{8}$/.test(raw)) return null;
  const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const parsed = new Date(`${formatted}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === formatted
    ? formatted
    : null;
}

export function normalizeKtoConcentrationItem(
  item: KtoDataLabItem,
  expectedDistrict: SeoulDataLabDistrict,
): KtoConcentrationForecast | null {
  const areaCode = scalar(item.areaCd);
  const areaName = scalar(item.areaNm);
  const districtCode = scalar(item.signguCd);
  const districtName = scalar(item.signguNm);
  const attractionName = scalar(item.tAtsNm);
  const forecastDate = isoDate(item.baseYmd);
  const concentrationIndex = Number(item.cnctrRate);
  if (
    areaCode !== SEOUL_AREA_CODE ||
    areaName !== '서울특별시' ||
    districtCode !== expectedDistrict.code ||
    districtName !== expectedDistrict.name ||
    !attractionName ||
    !forecastDate ||
    !Number.isFinite(concentrationIndex) ||
    concentrationIndex < 0 ||
    concentrationIndex > 100
  ) {
    return null;
  }
  return {
    areaCode,
    areaName,
    districtCode,
    districtName,
    attractionName,
    forecastDate,
    concentrationIndex,
  };
}

@Injectable()
export class KtoDataLabConcentrationProvider {
  constructor(private readonly config: ConfigService) {}

  get mode(): 'mock' | 'live' {
    return this.config.getOrThrow<'mock' | 'live'>('KTO_DATALAB_PROVIDER_MODE');
  }

  async fetchDistrict(
    district: SeoulDataLabDistrict,
    pageSize = 10_000,
  ): Promise<KtoConcentrationDistrictResult> {
    if (this.mode !== 'live') {
      throw new Error('KTO DataLab synchronization requires KTO_DATALAB_PROVIDER_MODE=live');
    }
    if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > 10_000) {
      throw new Error('KTO DataLab pageSize must be an integer between 1 and 10000');
    }

    const records: KtoConcentrationForecast[] = [];
    let rejectedCount = 0;
    let totalAvailable = 0;
    let pages = 0;
    for (let pageNo = 1; ; pageNo += 1) {
      const page = await this.fetchPage(district, pageNo, pageSize);
      pages += 1;
      totalAvailable = page.totalCount;
      const normalized = page.items.map((item) => normalizeKtoConcentrationItem(item, district));
      records.push(...normalized.filter((item): item is KtoConcentrationForecast => item !== null));
      rejectedCount += normalized.filter((item) => item === null).length;
      if (page.items.length === 0 || pageNo * pageSize >= page.totalCount) break;
    }

    return { district, totalAvailable, pages, records, rejectedCount };
  }

  private async fetchPage(
    district: SeoulDataLabDistrict,
    pageNo: number,
    pageSize: number,
  ): Promise<{ totalCount: number; items: KtoDataLabItem[] }> {
    const key = this.config.get<string>('KTO_DATALAB_API_KEY')?.trim();
    if (!key) throw new Error('KTO_DATALAB_API_KEY is required for KTO DataLab synchronization');
    const baseUrl = this.config
      .getOrThrow<string>('KTO_DATALAB_CONCENTRATION_URL')
      .replace(/\/$/, '');
    const url = new URL(baseUrl);
    url.searchParams.set('serviceKey', this.decodePortalKey(key));
    url.searchParams.set('pageNo', String(pageNo));
    url.searchParams.set('numOfRows', String(pageSize));
    url.searchParams.set('MobileOS', 'ETC');
    url.searchParams.set('MobileApp', this.config.getOrThrow<string>('KTO_MOBILE_APP'));
    url.searchParams.set('areaCd', SEOUL_AREA_CODE);
    url.searchParams.set('signguCd', district.code);
    url.searchParams.set('_type', 'json');

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      throw new BadGatewayException({
        code: 'KTO_DATALAB_NETWORK_ERROR',
        message: `KTO DataLab request failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    if (!response.ok) {
      throw new BadGatewayException({
        code: 'KTO_DATALAB_API_ERROR',
        message: `KTO DataLab request failed with ${response.status}`,
      });
    }

    let payload: KtoDataLabEnvelope;
    try {
      payload = (await response.json()) as KtoDataLabEnvelope;
    } catch {
      throw new BadGatewayException({
        code: 'KTO_DATALAB_INVALID_RESPONSE',
        message: 'KTO DataLab returned a non-JSON response',
      });
    }
    const header = payload.response?.header;
    if (scalar(header?.resultCode) !== '0000') {
      throw new BadGatewayException({
        code: 'KTO_DATALAB_API_ERROR',
        message: `KTO DataLab error: ${scalar(header?.resultMsg) ?? 'unknown error'}`,
      });
    }
    const body = payload.response?.body;
    if (!body || typeof body !== 'object') {
      throw new BadGatewayException({
        code: 'KTO_DATALAB_INVALID_RESPONSE',
        message: 'KTO DataLab returned an invalid response body',
      });
    }
    return {
      totalCount: nonNegativeInteger(body.totalCount, 0),
      items: itemArray(typeof body.items === 'object' ? body.items.item : undefined),
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
