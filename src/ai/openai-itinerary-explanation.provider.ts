import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { OPENAI_CLIENT } from './openai.provider';
import { DeterministicItineraryExplanationProvider } from './deterministic-itinerary-explanation.provider';
import { ItineraryExplanationOutputSchema } from './itinerary-explanation-output.schema';
import type {
  ItineraryExplanationInput,
  ItineraryExplanationProvider,
  ItineraryExplanationResult,
  StopExplanationItem,
} from './itinerary-explanation.types';

const EXPLANATION_SYSTEM_INSTRUCTIONS = `You write concise, natural, factual contextual explanations for a pre-calculated Seoul travel itinerary.
Return only the requested structured object matching the schema.

Rules:
- Never invent places, prices, opening hours, histories, atmospheres, menus, or amenities.
- Use only the verified facts provided in the input. Never assume facts beyond what is provided.
- Do not alter place names, prices, operating hours, distances, transit times, congestion levels, or addresses.
- Never describe regional area congestion (scope: area) as inside a specific store.
- Never describe estimated transit values as measured.
- Mandatory places and fixed appointments must be explained as user-specified constraints, not as chosen by recommendation score.
- For the first stop of the entire trip or the first stop of each day, previousStopFit MUST be null.
- For the last stop of the entire trip or the last stop of each day, nextStopFit MUST be null.
- If no verified description is provided, shortDescription must be a 1-sentence factual statement mentioning the place name, verified category, and district.
- Write natural and refined sentences in the requested locale ('ko' for Korean, 'ja' for Japanese).
- Never expose internal algorithm names (e.g. HeuristicRouteOptimizer, DeterministicRanker) or JSON field names in user-facing text.`;

@Injectable()
export class OpenAIItineraryExplanationProvider implements ItineraryExplanationProvider {
  private readonly logger = new Logger(OpenAIItineraryExplanationProvider.name);

  constructor(
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI | null,
    private readonly config: ConfigService,
    private readonly fallbackProvider: DeterministicItineraryExplanationProvider,
  ) {}

  async generate(input: ItineraryExplanationInput): Promise<ItineraryExplanationResult> {
    if (!this.client || this.config.get<'mock' | 'live'>('LLM_PROVIDER_MODE') !== 'live') {
      return this.fallbackProvider.generate(input, 'mock');
    }

    try {
      const model = this.config.get<string>('OPENAI_MODEL') ?? 'gpt-5.6-luna';

      // Build payload containing only verified facts
      const factsPayload = {
        locale: input.locale,
        preference: {
          area: input.preference.area,
          startDate: input.preference.startDate,
          endDate: input.preference.endDate,
          totalDays: input.preference.totalDays,
          startTime: input.preference.startTime,
          endTime: input.preference.endTime,
          budget: input.preference.budget,
          partySize: input.preference.partySize,
          companions: input.preference.companions,
          interests: input.preference.interests,
          preferences: input.preference.preferences,
          avoid: input.preference.avoid,
        },
        stops: input.stops.map((stop, index) => {
          const prevStop = index > 0 ? input.stops[index - 1] : undefined;
          const nextStop = index < input.stops.length - 1 ? input.stops[index + 1] : undefined;
          const isFirstOfDay = !prevStop || prevStop.dayNumber !== stop.dayNumber;
          const isLastOfDay = !nextStop || nextStop.dayNumber !== stop.dayNumber;

          return {
            order: stop.order,
            placeId: stop.placeId,
            dayNumber: stop.dayNumber,
            dayDate: stop.dayDate ?? undefined,
            isFirstOfDay,
            isLastOfDay,
            placeName: stop.placeName,
            category: stop.category,
            rawCategory: stop.rawCategory,
            address: stop.address,
            district: stop.district,
            stopType: stop.stopType,
            arrivalAt: stop.arrivalAt,
            leaveAt: stop.leaveAt,
            stayMinutes: stop.estimatedStayMinutes,
            cost: stop.estimatedCost,
            reason: stop.reason,
            scoreBreakdown: stop.scoreBreakdown,
            crowd: stop.crowdContext
              ? {
                  areaName: stop.crowdContext.areaName,
                  level: stop.crowdContext.congestionLevel,
                  scope: 'area',
                }
              : null,
            inboundTransit: stop.inboundRoute
              ? {
                  durationMinutes: stop.inboundRoute.durationMinutes,
                  distanceKm: stop.inboundRoute.distanceKm,
                  transportMode: stop.inboundRoute.transportMode,
                  evidence: stop.inboundRoute.evidence,
                }
              : null,
            nextTransit: stop.nextLegRoute
              ? {
                  durationMinutes: stop.nextLegRoute.durationMinutes,
                  distanceKm: stop.nextLegRoute.distanceKm,
                  transportMode: stop.nextLegRoute.transportMode,
                  evidence: stop.nextLegRoute.evidence,
                }
              : null,
            tourismEvidence: stop.tourismEvidence
              ? {
                  concentration: stop.tourismEvidence.concentration,
                  sourceRef: stop.tourismEvidence.sourceRef,
                }
              : null,
            verifiedDescription: stop.verifiedDescription ?? null,
          };
        }),
      };

      const response = await this.client.responses.parse({
        model,
        input: [
          { role: 'system', content: EXPLANATION_SYSTEM_INSTRUCTIONS },
          {
            role: 'user',
            content: `Generate contextual explanations for this Seoul itinerary:\n${JSON.stringify(factsPayload, null, 2)}`,
          },
        ],
        text: {
          format: zodTextFormat(ItineraryExplanationOutputSchema, 'itinerary_explanation'),
        },
      });

      const parsed = response.output_parsed;
      if (!parsed) {
        throw new Error('OpenAI returned empty explanation output');
      }

      // Server-side validation of OpenAI response
      if (!parsed.tripSummary || parsed.tripSummary.trim().length === 0) {
        throw new Error('OpenAI returned empty tripSummary');
      }

      if (parsed.stops.length !== input.stops.length) {
        throw new Error(
          `OpenAI returned ${parsed.stops.length} stops, expected ${input.stops.length}`,
        );
      }

      const validatedStops: StopExplanationItem[] = input.stops.map((expectedStop, index) => {
        const generated = parsed.stops[index];
        if (!generated) {
          throw new Error(`Missing explanation for stop index ${index}`);
        }

        if (generated.order !== expectedStop.order || generated.placeId !== expectedStop.placeId) {
          throw new Error(
            `Stop mismatch at index ${index}: expected (${expectedStop.order}, ${expectedStop.placeId}), got (${generated.order}, ${generated.placeId})`,
          );
        }

        if (!generated.shortDescription || generated.shortDescription.trim().length === 0) {
          throw new Error(`Empty shortDescription for stop ${expectedStop.placeId}`);
        }

        if (!generated.overallTripFit || generated.overallTripFit.trim().length === 0) {
          throw new Error(`Empty overallTripFit for stop ${expectedStop.placeId}`);
        }

        const prevStop = index > 0 ? input.stops[index - 1] : undefined;
        const nextStop = index < input.stops.length - 1 ? input.stops[index + 1] : undefined;
        const isFirstOfDay = !prevStop || prevStop.dayNumber !== expectedStop.dayNumber;
        const isLastOfDay = !nextStop || nextStop.dayNumber !== expectedStop.dayNumber;

        return {
          order: expectedStop.order,
          placeId: expectedStop.placeId,
          shortDescription: generated.shortDescription.trim(),
          previousStopFit: isFirstOfDay ? null : (generated.previousStopFit?.trim() ?? null),
          nextStopFit: isLastOfDay ? null : (generated.nextStopFit?.trim() ?? null),
          overallTripFit: generated.overallTripFit.trim(),
        };
      });

      return {
        tripSummary: parsed.tripSummary.trim(),
        locale: input.locale,
        stops: validatedStops,
        mode: 'live',
        model,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(
        `OpenAI itinerary explanation failed or rejected, falling back to deterministic explanation: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.fallbackProvider.generate(input, 'fallback');
    }
  }
}
