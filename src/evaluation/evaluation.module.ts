import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Place, RecommendationEvaluation } from '../database/entities';
import { PreferencesModule } from '../preferences/preferences.module';
import { ProvidersModule } from '../providers/providers.module';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { TourismFeatureModule } from '../tourism-feature/tourism-feature.module';
import { PlaceSearchQueryGenerator } from '../trips/place-search-query-generator';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Place, RecommendationEvaluation]),
    PreferencesModule,
    ProvidersModule,
    RecommendationModule,
    TourismFeatureModule,
  ],
  controllers: [EvaluationController],
  providers: [EvaluationService, PlaceSearchQueryGenerator],
})
export class EvaluationModule {}
