import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OPENAI_CLIENT, OpenAIProvider } from './openai.provider';
import { DeterministicItineraryExplanationProvider } from './deterministic-itinerary-explanation.provider';
import { OpenAIItineraryExplanationProvider } from './openai-itinerary-explanation.provider';
import {
  ITINERARY_EXPLANATION_PROVIDER,
  type ItineraryExplanationProvider,
} from './itinerary-explanation.types';
import { TripPreferenceSchemaValidator } from '../preferences/trip-preference-schema.validator';

@Module({
  providers: [
    {
      provide: OPENAI_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): OpenAI | null =>
        config.get<'mock' | 'live'>('LLM_PROVIDER_MODE') === 'live' ||
        config.get<boolean>('PLACE_DETAIL_WEB_SEARCH_ENABLED')
          ? new OpenAI({ apiKey: config.getOrThrow<string>('OPENAI_API_KEY') })
          : null,
    },
    TripPreferenceSchemaValidator,
    OpenAIProvider,
    DeterministicItineraryExplanationProvider,
    OpenAIItineraryExplanationProvider,
    {
      provide: ITINERARY_EXPLANATION_PROVIDER,
      inject: [
        ConfigService,
        OpenAIItineraryExplanationProvider,
        DeterministicItineraryExplanationProvider,
      ],
      useFactory: (
        config: ConfigService,
        live: OpenAIItineraryExplanationProvider,
        mock: DeterministicItineraryExplanationProvider,
      ): ItineraryExplanationProvider =>
        config.get<'mock' | 'live'>('LLM_PROVIDER_MODE') === 'live' ? live : mock,
    },
  ],
  exports: [
    OPENAI_CLIENT,
    TripPreferenceSchemaValidator,
    OpenAIProvider,
    DeterministicItineraryExplanationProvider,
    OpenAIItineraryExplanationProvider,
    ITINERARY_EXPLANATION_PROVIDER,
  ],
})
export class AiModule {}
