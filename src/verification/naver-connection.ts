import { ConfigService } from '@nestjs/config';
import { TtlCache } from '../common/cache/ttl-cache';
import { NaverPlaceProvider } from '../providers/place/naver-place.provider';

export interface NaverConnectionSummary {
  provider: 'naver-api-hub';
  endpoint: string;
  authenticated: true;
  query: string;
  resultCount: number;
  resultsWithCoordinates: number;
}

export async function verifyNaverConnection(
  values: Record<string, unknown>,
  area = '성수',
  query = '카페',
): Promise<NaverConnectionSummary> {
  const clientId = typeof values.NAVER_CLIENT_ID === 'string' ? values.NAVER_CLIENT_ID.trim() : '';
  const clientSecret =
    typeof values.NAVER_CLIENT_SECRET === 'string' ? values.NAVER_CLIENT_SECRET.trim() : '';
  if (!clientId || !clientSecret) {
    throw new Error('NAVER_CLIENT_ID and NAVER_CLIENT_SECRET must be set in backend/.env');
  }

  const endpoint =
    typeof values.NAVER_LOCAL_SEARCH_URL === 'string' &&
    values.NAVER_LOCAL_SEARCH_URL.trim().length > 0
      ? values.NAVER_LOCAL_SEARCH_URL.trim()
      : 'https://naverapihub.apigw.ntruss.com/search/v1/local';
  const provider = new NaverPlaceProvider(
    new ConfigService({
      NAVER_CLIENT_ID: clientId,
      NAVER_CLIENT_SECRET: clientSecret,
      NAVER_LOCAL_SEARCH_URL: endpoint,
      PROVIDER_CACHE_TTL_SECONDS: 1,
    }),
    new TtlCache(),
  );
  const response = await provider.search({ area, query, limit: 5 });
  if (response.places.length === 0) {
    throw new Error('NAVER API HUB authenticated successfully but returned no Seoul places');
  }

  return {
    provider: 'naver-api-hub',
    endpoint,
    authenticated: true,
    query: response.query,
    resultCount: response.places.length,
    resultsWithCoordinates: response.places.filter(
      (place) => place.latitude !== null && place.longitude !== null,
    ).length,
  };
}
