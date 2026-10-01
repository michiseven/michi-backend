import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { OPENAI_CLIENT } from '../../ai/openai.provider';
import {
  ITINERARY_PLACE_PROVIDER,
  type PlaceProvider,
  type PlaceSearchRequest,
} from './place-provider';
import {
  runPlaceSearchAgent,
  type PlaceSearchAgentResult,
  type PlaceSearchAgentObservation,
} from './place-search-agent-loop';
import { createOpenAIPlaceSearchDecider } from './openai-place-search-decider';

export type PlaceSearchAgentPublicResult = {
  locale: 'ko' | 'ja';
  observations: Array<{
    query: string;
    status: PlaceSearchAgentObservation['status'];
    eligibleCount: number;
  }>;
} & (
  | Omit<Extract<PlaceSearchAgentResult, { status: 'clarify' }>, 'observations'>
  | Omit<Extract<PlaceSearchAgentResult, { status: 'failed' }>, 'observations'>
  | {
      status: 'completed';
      places: Array<{
        key: string;
        name: string;
        category: string | null;
        address: string | null;
        longitude: number | null;
        latitude: number | null;
        providerMode: 'live' | 'mock';
      }>;
      routeValidation: 'not_performed';
      openingHoursVerification: 'unverified';
    }
);

@Injectable()
export class PlaceSearchAgentService {
  constructor(
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI | null,
    private readonly config: ConfigService,
    @Inject(ITINERARY_PLACE_PROVIDER) private readonly provider: PlaceProvider,
  ) {}

  async search(
    request: PlaceSearchRequest,
    locale: 'ko' | 'ja' = 'ko',
    parentSignal?: AbortSignal,
  ): Promise<PlaceSearchAgentPublicResult> {
    if (!this.client)
      throw new ServiceUnavailableException({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Place search agent requires a configured LLM provider',
      });
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000);
    const decide = createOpenAIPlaceSearchDecider(
      this.client,
      this.config.getOrThrow<string>('OPENAI_MODEL'),
      locale,
    );
    // Locale is user context only; never send credentials or raw provider payload.
    const result = await runPlaceSearchAgent(
      request,
      decide,
      async (searchRequest, searchSignal) => {
        searchSignal.throwIfAborted();
        const response = await this.provider.search({
          ...searchRequest,
          singleAttempt: true,
          signal: searchSignal,
        });
        return response.places;
      },
      signal,
    );
    const observations = result.observations.map((observation) => ({
      query: observation.query,
      status: observation.status,
      eligibleCount: observation.places.length,
    }));
    return result.status === 'completed'
      ? {
          status: result.status,
          locale,
          observations,
          places: result.places.map((place) => ({
            key: `${place.provider}:${place.sourcePlaceId}`,
            name: place.name,
            category: place.rawCategory,
            address: place.roadAddress ?? place.address,
            longitude: place.longitude,
            latitude: place.latitude,
            providerMode: place.providerMode,
          })),
          routeValidation: 'not_performed' as const,
          openingHoursVerification: 'unverified' as const,
        }
      : { ...result, locale, observations };
  }
}
