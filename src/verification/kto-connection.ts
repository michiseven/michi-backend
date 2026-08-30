import { ConfigService } from '@nestjs/config';
import { KTO_PLACE_SOURCE, KtoPlaceProvider } from '../providers/place/kto-place.provider';

export interface KtoConnectionSummary {
  provider: typeof KTO_PLACE_SOURCE;
  endpoint: string;
  authenticated: true;
  seoulTotalCount: number;
  acceptedCount: number;
  rejectedCount: number;
  resultsWithCoordinates: number;
  resultsWithJapaneseText: number;
}

export async function verifyKtoConnection(
  values: Record<string, unknown>,
): Promise<KtoConnectionSummary> {
  const serviceKey =
    typeof values.KTO_TOUR_API_KEY === 'string' ? values.KTO_TOUR_API_KEY.trim() : '';
  if (!serviceKey) {
    throw new Error('KTO_TOUR_API_KEY must be set in backend/.env');
  }

  const baseUrl =
    typeof values.KTO_TOUR_API_BASE_URL === 'string' &&
    values.KTO_TOUR_API_BASE_URL.trim().length > 0
      ? values.KTO_TOUR_API_BASE_URL.trim().replace(/\/$/, '')
      : 'https://apis.data.go.kr/B551011/JpnService2';
  const provider = new KtoPlaceProvider(
    new ConfigService({
      KTO_PROVIDER_MODE: 'live',
      KTO_TOUR_API_KEY: serviceKey,
      KTO_TOUR_API_BASE_URL: baseUrl,
      KTO_MOBILE_APP: 'Michi',
    }),
  );
  const page = await provider.fetchSeoulPage(1, 20);
  if (page.totalCount <= 0 || page.places.length === 0) {
    throw new Error('KTO TourAPI authenticated successfully but returned no valid Seoul places');
  }

  return {
    provider: KTO_PLACE_SOURCE,
    endpoint: `${baseUrl}/areaBasedList2`,
    authenticated: true,
    seoulTotalCount: page.totalCount,
    acceptedCount: page.places.length,
    rejectedCount: page.rejectedCount,
    resultsWithCoordinates: page.places.filter(
      (place) => place.latitude !== null && place.longitude !== null,
    ).length,
    resultsWithJapaneseText: page.places.filter((place) =>
      /[\u3040-\u30ff\u3400-\u9fff]/u.test(place.name),
    ).length,
  };
}
