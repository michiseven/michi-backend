import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { resolveDatabaseUrl } from '../common/config/env.validation';
import {
  ExternalDataSnapshot,
  JapaneseMarketMetric,
  Place,
  PlaceDescriptionTranslation,
  PlaceDetailEvidence,
  PedestrianAccessibilityFeature,
  Receipt,
  ReceiptItem,
  RecommendationResult,
  RecommendationEvaluation,
  RecommendationScore,
  RefreshToken,
  SeoulSpatialArea,
  Trip,
  TripPreference,
  TripStop,
  TourismDataSource,
  TourismImportRun,
  TourismMetric,
  TransitStation,
  User,
  UserEvent,
  UserSavedTrip,
  Visit,
  ChatThread,
} from './entities';
import { InitialMichiSchema1723996800000 } from './migrations/1723996800000-initial-michi-schema';
import { AddReceiptFoundation1723996801000 } from './migrations/1723996801000-add-receipt-foundation';
import { AddTourismFeatureStore1723996802000 } from './migrations/1723996802000-add-tourism-feature-store';
import { AddRecommendationEvaluation1723996803000 } from './migrations/1723996803000-add-recommendation-evaluation';
import { AddSeoulSpatialAreas1723996804000 } from './migrations/1723996804000-add-seoul-spatial-areas';
import { AddTripStopTypeAndRainFallback1723996805000 } from './migrations/1723996805000-add-trip-stop-type-and-rain-fallback';
import { AddRoutingAndAccessibilityEvidence1723996806000 } from './migrations/1723996806000-add-routing-and-accessibility-evidence';
import { AddTransitStations1723996807000 } from './migrations/1723996807000-add-transit-stations';
import { AddItineraryExplanations1723996808000 } from './migrations/1723996808000-add-itinerary-explanations';
import { AddEvidenceControlledBenchmark1723996809000 } from './migrations/1723996809000-add-evidence-controlled-benchmark';
import { AddUserMemberSystem1723996810000 } from './migrations/1723996810000-add-user-member-system';
import { AddPlacePriceEvidence1723996820000 } from './migrations/1723996820000-add-place-price-evidence';
import { RemoveUnverifiedPlacePrices1723996821000 } from './migrations/1723996821000-remove-unverified-place-prices';
import { ClearIncompleteTripCostTotals1723996822000 } from './migrations/1723996822000-clear-incomplete-trip-cost-totals';
import { AddTripEditToken1723996823000 } from './migrations/1723996823000-add-trip-edit-token';
import { AddChatThreads1723996824000 } from './migrations/1723996824000-add-chat-threads';
import { AddPlaceDetailEvidences1723996825000 } from './migrations/1723996825000-add-place-detail-evidences';
import { AddPlaceDescriptionTranslations1723996826000 } from './migrations/1723996826000-add-place-description-translations';

config({ path: ['.env', '../.env'], quiet: true });

const dataSource = new DataSource({
  type: 'postgres',
  url: resolveDatabaseUrl(process.env),
  entities: [
    Trip,
    TripPreference,
    Place,
    PlaceDescriptionTranslation,
    PlaceDetailEvidence,
    PedestrianAccessibilityFeature,
    TripStop,
    RecommendationResult,
    RecommendationEvaluation,
    RecommendationScore,
    SeoulSpatialArea,
    ExternalDataSnapshot,
    JapaneseMarketMetric,
    User,
    UserEvent,
    UserSavedTrip,
    RefreshToken,
    Receipt,
    ReceiptItem,
    Visit,
    TourismDataSource,
    TourismImportRun,
    TourismMetric,
    TransitStation,
    ChatThread,
  ],
  migrations: [
    InitialMichiSchema1723996800000,
    AddReceiptFoundation1723996801000,
    AddTourismFeatureStore1723996802000,
    AddRecommendationEvaluation1723996803000,
    AddSeoulSpatialAreas1723996804000,
    AddTripStopTypeAndRainFallback1723996805000,
    AddRoutingAndAccessibilityEvidence1723996806000,
    AddTransitStations1723996807000,
    AddItineraryExplanations1723996808000,
    AddEvidenceControlledBenchmark1723996809000,
    AddUserMemberSystem1723996810000,
    AddPlacePriceEvidence1723996820000,
    RemoveUnverifiedPlacePrices1723996821000,
    ClearIncompleteTripCostTotals1723996822000,
    AddTripEditToken1723996823000,
    AddChatThreads1723996824000,
    AddPlaceDetailEvidences1723996825000,
    AddPlaceDescriptionTranslations1723996826000,
  ],
  synchronize: false,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

export default dataSource;
