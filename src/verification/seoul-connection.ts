import { ConfigService } from '@nestjs/config';
import { TtlCache } from '../common/cache/ttl-cache';
import { SeoulCrowdProvider } from '../providers/crowd/seoul-crowd.provider';

export interface SeoulConnectionSummary {
  provider: 'seoul-open-data';
  endpoint: string;
  authenticated: true;
  scope: 'area';
  areaName: string;
  areaCode: string | null;
  congestionLevel: string;
  observedAt: string;
  hasCongestionMessage: boolean;
}

export async function verifySeoulConnection(
  values: Record<string, unknown>,
  areaName = '성수카페거리',
): Promise<SeoulConnectionSummary> {
  const apiKey =
    typeof values.SEOUL_OPEN_DATA_API_KEY === 'string' ? values.SEOUL_OPEN_DATA_API_KEY.trim() : '';
  if (!apiKey) {
    throw new Error('SEOUL_OPEN_DATA_API_KEY must be set in backend/.env');
  }

  const baseUrl =
    typeof values.SEOUL_OPEN_DATA_BASE_URL === 'string' &&
    values.SEOUL_OPEN_DATA_BASE_URL.trim().length > 0
      ? values.SEOUL_OPEN_DATA_BASE_URL.trim().replace(/\/$/, '')
      : 'http://openapi.seoul.go.kr:8088';
  const provider = new SeoulCrowdProvider(
    new ConfigService({
      SEOUL_OPEN_DATA_API_KEY: apiKey,
      SEOUL_OPEN_DATA_BASE_URL: baseUrl,
      PROVIDER_CACHE_TTL_SECONDS: 1,
    }),
    new TtlCache(),
  );
  const observation = await provider.getAreaCrowd(areaName);
  if (!observation) {
    throw new Error('Seoul Open Data does not provide a crowd observation for the requested area');
  }
  if (!observation.congestionLevel || !observation.observedAt) {
    throw new Error('Seoul Open Data authenticated but omitted congestion level or observed time');
  }

  return {
    provider: 'seoul-open-data',
    endpoint: `${baseUrl}/{KEY}/json/citydata_ppltn/1/5/{AREA_NAME}`,
    authenticated: true,
    scope: observation.scope,
    areaName: observation.areaName,
    areaCode: observation.areaCode,
    congestionLevel: observation.congestionLevel,
    observedAt: observation.observedAt,
    hasCongestionMessage: observation.congestionMessage !== null,
  };
}
