import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { PlaceDescriptionTranslation, PlaceDetailEvidence } from '../database/entities';
import { OpenAIPlaceDescriptionSearchProvider } from './openai-place-description-search.provider';
import { PlaceDescriptionTranslationService } from './place-description-translation.service';
import { OpenAIPlaceDetailSearchProvider } from './openai-place-detail-search.provider';
import { PlaceDetailEnrichmentService } from './place-detail-enrichment.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlaceDetailEvidence, PlaceDescriptionTranslation]), AiModule],
  providers: [
    OpenAIPlaceDetailSearchProvider,
    PlaceDetailEnrichmentService,
    OpenAIPlaceDescriptionSearchProvider,
    PlaceDescriptionTranslationService,
  ],
  exports: [PlaceDetailEnrichmentService, PlaceDescriptionTranslationService],
})
export class PlaceDetailsModule {}
