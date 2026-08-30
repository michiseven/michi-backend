import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiModule } from '../ai/ai.module';
import { OpenAIProvider } from '../ai/openai.provider';
import { MockTripPreferenceParser } from './mock-trip-preference.parser';
import { TRIP_PREFERENCE_PARSER, type TripPreferenceParser } from './preference-parser';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';
import { TripPreferenceSchemaValidator } from './trip-preference-schema.validator';

@Module({
  imports: [AiModule],
  controllers: [PreferencesController],
  providers: [
    TripPreferenceSchemaValidator,
    MockTripPreferenceParser,
    {
      provide: TRIP_PREFERENCE_PARSER,
      inject: [ConfigService, OpenAIProvider, MockTripPreferenceParser],
      useFactory: (
        config: ConfigService,
        live: OpenAIProvider,
        mock: MockTripPreferenceParser,
      ): TripPreferenceParser =>
        config.get<'mock' | 'live'>('LLM_PROVIDER_MODE') === 'live' ? live : mock,
    },
    PreferencesService,
  ],
  exports: [PreferencesService, TripPreferenceSchemaValidator, TRIP_PREFERENCE_PARSER],
})
export class PreferencesModule {}
