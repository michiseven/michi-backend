import { DataSource } from 'typeorm';
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
import { KTO_PLACE_SOURCE } from '../providers/place/kto-place.provider';
import { PlaceCandidateSearchService } from '../providers/place/place-candidate-search.service';
import { seoulSearchArea } from '../providers/place/seoul-area-centers';

export interface PostgisCandidateSummary {
  database: string;
  area: string;
  radiusMeters: number;
  totalWithinRadius: number;
  candidateCount: number;
  nearestDistanceMeters: number | null;
  farthestDistanceMeters: number | null;
  sourceCounts: Record<string, number>;
}

export async function verifyPostgisCandidates(
  values: Record<string, unknown>,
  area = '성수',
): Promise<PostgisCandidateSummary> {
  const dbUrl = resolveDatabaseUrl(values);
  const databaseName =
    typeof values.POSTGRES_DB === 'string' && values.POSTGRES_DB.trim().length > 0
      ? values.POSTGRES_DB.trim()
      : 'michi';

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
    const service = new PlaceCandidateSearchService(repository);
    const center = seoulSearchArea(area);
    const candidates = await service.searchKtoCandidates({ area, limit: 100 });
    const spatialPredicate = `ST_DWithin(
      place.location,
      ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography,
      :radiusMeters
    )`;
    const parameters = {
      longitude: center.longitude,
      latitude: center.latitude,
      radiusMeters: center.radiusMeters,
    };
    const totalWithinRadius = await repository
      .createQueryBuilder('place')
      .where('place.source = :source', { source: KTO_PLACE_SOURCE })
      .andWhere('place.location IS NOT NULL')
      .andWhere(spatialPredicate, parameters)
      .getCount();

    const sourceCounts: Record<string, number> = {};
    for (const candidate of candidates) {
      sourceCounts[candidate.source] = (sourceCounts[candidate.source] ?? 0) + 1;
    }

    const distanceRows =
      candidates.length === 0
        ? []
        : await repository
            .createQueryBuilder('place')
            .select(
              `ST_Distance(
                place.location,
                ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography
              )`,
              'distanceMeters',
            )
            .where('place.id IN (:...ids)', { ids: candidates.map((candidate) => candidate.id) })
            .setParameters(parameters)
            .getRawMany<{ distanceMeters: string }>();
    const distances = distanceRows
      .map((row) => Number(row.distanceMeters))
      .filter((distance) => Number.isFinite(distance))
      .map((distance) => Math.round(distance * 10) / 10);

    const nearestDistanceMeters = distances.length > 0 ? Math.min(...distances) : null;
    const farthestDistanceMeters = distances.length > 0 ? Math.max(...distances) : null;

    return {
      database: databaseName,
      area,
      radiusMeters: center.radiusMeters,
      totalWithinRadius,
      candidateCount: candidates.length,
      nearestDistanceMeters,
      farthestDistanceMeters,
      sourceCounts: Object.keys(sourceCounts).length > 0 ? sourceCounts : { [KTO_PLACE_SOURCE]: 0 },
    };
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}
