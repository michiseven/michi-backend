import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TtlCache } from '../common/cache/ttl-cache';
import { resolveDatabaseUrl } from '../common/config/env.validation';
import {
  ExternalDataSnapshot,
  JapaneseMarketMetric,
  Place,
  Receipt,
  ReceiptItem,
  RecommendationEvaluation,
  RecommendationResult,
  RecommendationScore,
  TourismDataSource,
  TourismImportRun,
  TourismMetric,
  Trip,
  TripPreference,
  TripStop,
  UserEvent,
  Visit,
} from '../database/entities';
import { NaverPlaceProvider } from '../providers/place/naver-place.provider';
import { PlaceCandidateSearchService } from '../providers/place/place-candidate-search.service';
import { DedupReason, PlaceDeduplicator } from '../providers/place/place-deduplicator';
import { PlaceNormalizer } from '../providers/place/place-normalizer';

export interface DedupVerificationSummary {
  area: string;
  query: string;
  ktoCandidateCount: number;
  naverCandidateCount: number;
  duplicateGroupCount: number;
  finalCandidateCount: number;
  dedupReasonCounts: Record<DedupReason, number>;
}

export async function verifyDedup(
  values: Record<string, unknown>,
  area = '성수',
  query = '카페',
): Promise<DedupVerificationSummary> {
  const dbUrl = resolveDatabaseUrl(values);
  const dataSource = new DataSource({
    type: 'postgres',
    url: dbUrl,
    entities: [
      Trip,
      TripPreference,
      Place,
      TripStop,
      RecommendationResult,
      RecommendationEvaluation,
      RecommendationScore,
      ExternalDataSnapshot,
      JapaneseMarketMetric,
      UserEvent,
      Receipt,
      ReceiptItem,
      Visit,
      TourismDataSource,
      TourismImportRun,
      TourismMetric,
    ],
    synchronize: false,
    ssl: values.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await dataSource.initialize();
  try {
    const repository = dataSource.getRepository(Place);
    const ktoSearchService = new PlaceCandidateSearchService(repository);
    const ktoCandidates = await ktoSearchService.searchKtoCandidates({ area, limit: 50 });

    const clientId =
      typeof values.NAVER_CLIENT_ID === 'string' ? values.NAVER_CLIENT_ID.trim() : '';
    const clientSecret =
      typeof values.NAVER_CLIENT_SECRET === 'string' ? values.NAVER_CLIENT_SECRET.trim() : '';
    const endpoint =
      typeof values.NAVER_LOCAL_SEARCH_URL === 'string' &&
      values.NAVER_LOCAL_SEARCH_URL.trim().length > 0
        ? values.NAVER_LOCAL_SEARCH_URL.trim()
        : 'https://naverapihub.apigw.ntruss.com/search/v1/local';

    const naverProvider = new NaverPlaceProvider(
      new ConfigService({
        NAVER_CLIENT_ID: clientId,
        NAVER_CLIENT_SECRET: clientSecret,
        NAVER_LOCAL_SEARCH_URL: endpoint,
        PROVIDER_CACHE_TTL_SECONDS: 1,
      }),
      new TtlCache(),
    );

    const normalizer = new PlaceNormalizer();
    const naverSearchResponse = await naverProvider.search({ area, query, limit: 10 });
    const naverCandidates: Place[] = naverSearchResponse.places.map((record) => {
      const normalized = normalizer.normalize(record);
      return repository.create({
        ...normalized,
        id: `naver-live-${record.sourcePlaceId.slice(-8)}`,
      });
    });

    const deduplicator = new PlaceDeduplicator();
    const combined = [...ktoCandidates, ...naverCandidates];
    const deduplicated = deduplicator.deduplicate(combined);

    return {
      area,
      query,
      ktoCandidateCount: ktoCandidates.length,
      naverCandidateCount: naverCandidates.length,
      duplicateGroupCount: deduplicated.removedCount,
      finalCandidateCount: deduplicated.places.length,
      dedupReasonCounts: deduplicated.reasonCounts,
    };
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}
