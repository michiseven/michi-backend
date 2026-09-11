import { Module } from '@nestjs/common';
import { DbFirstPlaceProvider } from './place/db-first-place.provider';
import { ITINERARY_PLACE_PROVIDER } from './place/place-provider';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TtlCache } from '../common/cache/ttl-cache';
import { Place, SeoulSpatialArea } from '../database/entities';
import { CROWD_PROVIDER, type CrowdProvider } from './crowd/crowd-provider';
import { MockCrowdProvider } from './crowd/mock-crowd.provider';
import { SeoulCrowdProvider } from './crowd/seoul-crowd.provider';
import { MockPlaceProvider } from './place/mock-place.provider';
import { KakaoPlaceProvider } from './place/kakao-place.provider';
import { KtoPlaceProvider } from './place/kto-place.provider';
import { KtoSeoulSyncService } from './place/kto-seoul-sync.service';
import { PlaceCandidateSearchService } from './place/place-candidate-search.service';
import { PlaceDeduplicator } from './place/place-deduplicator';
import { NaverPlaceProvider } from './place/naver-place.provider';
import { PlaceNormalizer } from './place/place-normalizer';
import { SeoulSpatialAreaService } from './place/seoul-spatial-area.service';
import { PLACE_PROVIDER, type PlaceProvider } from './place/place-provider';

@Module({
  imports: [TypeOrmModule.forFeature([Place, SeoulSpatialArea])],
  providers: [
    TtlCache,
    PlaceNormalizer,
    KakaoPlaceProvider,
    NaverPlaceProvider,
    MockPlaceProvider,
    KtoPlaceProvider,
    KtoSeoulSyncService,
    PlaceCandidateSearchService,
    DbFirstPlaceProvider,
    {
      provide: ITINERARY_PLACE_PROVIDER,
      inject: [ConfigService, DbFirstPlaceProvider, MockPlaceProvider],
      useFactory: (
        config: ConfigService,
        live: DbFirstPlaceProvider,
        mock: MockPlaceProvider,
      ): PlaceProvider =>
        config.getOrThrow<'mock' | 'live'>('PLACE_PROVIDER_MODE') === 'mock' ? mock : live,
    },
    PlaceDeduplicator,
    SeoulSpatialAreaService,
    SeoulCrowdProvider,
    MockCrowdProvider,
    {
      provide: PLACE_PROVIDER,
      inject: [ConfigService, KakaoPlaceProvider, NaverPlaceProvider, MockPlaceProvider],
      useFactory: (
        config: ConfigService,
        kakao: KakaoPlaceProvider,
        naver: NaverPlaceProvider,
        mock: MockPlaceProvider,
      ): PlaceProvider => {
        if (config.getOrThrow<'mock' | 'live'>('PLACE_PROVIDER_MODE') === 'mock') return mock;
        return config.getOrThrow<'kakao' | 'naver'>('PLACE_PROVIDER_LIVE_SOURCE') === 'kakao'
          ? kakao
          : naver;
      },
    },
    {
      provide: CROWD_PROVIDER,
      inject: [ConfigService, SeoulCrowdProvider, MockCrowdProvider],
      useFactory: (
        config: ConfigService,
        live: SeoulCrowdProvider,
        mock: MockCrowdProvider,
      ): CrowdProvider =>
        config.getOrThrow<'mock' | 'live'>('CROWD_PROVIDER_MODE') === 'live' ? live : mock,
    },
  ],
  exports: [
    ITINERARY_PLACE_PROVIDER,
    PLACE_PROVIDER,
    CROWD_PROVIDER,
    PlaceNormalizer,
    KtoPlaceProvider,
    KtoSeoulSyncService,
    PlaceCandidateSearchService,
    PlaceDeduplicator,
    SeoulSpatialAreaService,
  ],
})
export class ProvidersModule {}
