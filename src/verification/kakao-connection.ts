import { ConfigService } from '@nestjs/config';
import { TtlCache } from '../common/cache/ttl-cache';
import { KakaoPlaceProvider } from '../providers/place/kakao-place.provider';

export interface KakaoConnectionSummary {
  provider: 'kakao-local';
  endpoint: string;
  authenticated: true;
  query: string;
  resultCount: number;
  resultsWithCoordinates: number;
  stableProviderIds: number;
}

export async function verifyKakaoConnection(
  values: Record<string, unknown>,
  area = '공덕',
  query = '카페',
): Promise<KakaoConnectionSummary> {
  const apiKey =
    typeof values.KAKAO_REST_API_KEY === 'string' ? values.KAKAO_REST_API_KEY.trim() : '';
  if (!apiKey) throw new Error('KAKAO_REST_API_KEY must be set in backend/.env');

  const endpoint =
    typeof values.KAKAO_LOCAL_SEARCH_URL === 'string' &&
    values.KAKAO_LOCAL_SEARCH_URL.trim().length > 0
      ? values.KAKAO_LOCAL_SEARCH_URL.trim()
      : 'https://dapi.kakao.com/v2/local/search/keyword.json';
  const provider = new KakaoPlaceProvider(
    new ConfigService({
      KAKAO_REST_API_KEY: apiKey,
      KAKAO_LOCAL_SEARCH_URL: endpoint,
      PROVIDER_CACHE_TTL_SECONDS: 1,
    }),
    new TtlCache(),
  );
  const response = await provider.search({ area, query, limit: 15 });
  if (response.places.length === 0) {
    throw new Error('Kakao Local API authenticated successfully but returned no Seoul places');
  }

  return {
    provider: 'kakao-local',
    endpoint,
    authenticated: true,
    query: response.query,
    resultCount: response.places.length,
    resultsWithCoordinates: response.places.filter(
      (place) => place.latitude !== null && place.longitude !== null,
    ).length,
    stableProviderIds: response.places.filter((place) => place.sourcePlaceIdKind === 'provider')
      .length,
  };
}
