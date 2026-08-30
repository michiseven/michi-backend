import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TtlCache } from '../../common/cache/ttl-cache';
import type { CrowdObservation, CrowdProvider } from './crowd-provider';

interface SeoulPopulationStatus {
  AREA_CONGEST_LVL?: unknown;
  AREA_CONGEST_MSG?: unknown;
  PPLTN_TIME?: unknown;
}

interface SeoulAreaPayload {
  AREA_NM?: unknown;
  AREA_CD?: unknown;
  AREA_CONGEST_LVL?: unknown;
  AREA_CONGEST_MSG?: unknown;
  PPLTN_TIME?: unknown;
  LIVE_PPLTN_STTS?: SeoulPopulationStatus[];
}

interface SeoulApiPayload {
  'SeoulRtd.citydata_ppltn'?: SeoulAreaPayload[];
  'RESULT.CODE'?: unknown;
  'RESULT.MESSAGE'?: unknown;
  RESULT?: { 'RESULT.CODE'?: unknown; 'RESULT.MESSAGE'?: unknown };
  SeoulRtd?: {
    RESULT?: { CODE?: unknown; MESSAGE?: unknown };
    citydata_ppltn?: SeoulAreaPayload[];
  };
}

const SEOUL_REALTIME_AREA_NAMES: Readonly<Record<string, string>> = {
  성수: '성수카페거리',
};

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

@Injectable()
export class SeoulCrowdProvider implements CrowdProvider {
  readonly mode = 'live' as const;
  readonly name = 'seoul-open-data';

  constructor(
    private readonly config: ConfigService,
    private readonly cache: TtlCache,
  ) {}

  async getAreaCrowd(areaName: string): Promise<CrowdObservation | null> {
    const normalizedArea = areaName.trim();
    const cacheKey = `crowd:seoul:${normalizedArea}`;
    const cached = this.cache.get<CrowdObservation>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.config.getOrThrow<string>('SEOUL_OPEN_DATA_BASE_URL');
    const key = this.config.getOrThrow<string>('SEOUL_OPEN_DATA_API_KEY');
    const providerAreaName = SEOUL_REALTIME_AREA_NAMES[normalizedArea] ?? normalizedArea;
    const requestUrl = `${baseUrl}/${encodeURIComponent(key)}/json/citydata_ppltn/1/5/${encodeURIComponent(providerAreaName)}`;
    const sourceUrl = 'https://data.seoul.go.kr/dataList/OA-21778/A/1/datasetView.do';
    let response: Response;
    try {
      response = await fetch(requestUrl, { signal: AbortSignal.timeout(5_000) });
    } catch (error) {
      throw new BadGatewayException({
        code: 'CROWD_PROVIDER_UNAVAILABLE',
        message: 'Seoul Open Data request failed',
        details: error instanceof Error ? error.message : 'network error',
      });
    }
    if (!response.ok) {
      throw new BadGatewayException({
        code: 'CROWD_PROVIDER_ERROR',
        message: 'Seoul Open Data returned an error',
        details: { status: response.status },
      });
    }

    const payload = (await response.json()) as SeoulApiPayload;
    const legacyRoot = payload.SeoulRtd;
    const code = optionalString(
      payload['RESULT.CODE'] ?? payload.RESULT?.['RESULT.CODE'] ?? legacyRoot?.RESULT?.CODE,
    );
    const providerMessage =
      payload['RESULT.MESSAGE'] ??
      payload.RESULT?.['RESULT.MESSAGE'] ??
      legacyRoot?.RESULT?.MESSAGE ??
      null;
    const areas = payload['SeoulRtd.citydata_ppltn'] ?? legacyRoot?.citydata_ppltn;
    if (!areas && code === 'ERROR-500') return null;
    if (!areas || (code !== null && code !== 'INFO-000')) {
      throw new BadGatewayException({
        code: 'CROWD_PROVIDER_INVALID_RESPONSE',
        message: 'Seoul Open Data response was invalid',
        details: { providerCode: code, providerMessage },
      });
    }
    const area = areas[0];
    const status = area?.LIVE_PPLTN_STTS?.[0] ?? area;
    if (!area) {
      throw new BadGatewayException({
        code: 'CROWD_AREA_NOT_FOUND',
        message: 'Seoul Open Data did not return the requested area',
      });
    }

    const result: CrowdObservation = {
      provider: this.name,
      providerMode: this.mode,
      scope: 'area',
      areaName: optionalString(area.AREA_NM) ?? normalizedArea,
      areaCode: optionalString(area.AREA_CD),
      congestionLevel: optionalString(status?.AREA_CONGEST_LVL),
      congestionMessage: optionalString(status?.AREA_CONGEST_MSG),
      observedAt: optionalString(status?.PPLTN_TIME),
      disclaimer: '서울시 주요 지역 단위 혼잡도이며 특정 장소 내부의 혼잡도를 의미하지 않습니다.',
      sourceUrl,
      rawPayload: area as Record<string, unknown>,
    };
    this.cache.set(cacheKey, result, this.config.getOrThrow<number>('PROVIDER_CACHE_TTL_SECONDS'));
    return result;
  }
}
