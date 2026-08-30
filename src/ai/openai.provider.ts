import {
  BadGatewayException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { TripPreferenceParser } from '../preferences/preference-parser';
import type {
  ParsedTripPreference,
  PreferenceParseInput,
  PreferenceParseResult,
} from '../preferences/preference.types';
import { TripPreferenceSchemaValidator } from '../preferences/trip-preference-schema.validator';
import { TripPreferenceOutputSchema } from './trip-preference-output.schema';

export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');

const SYSTEM_INSTRUCTIONS = `You extract structured travel constraints for a Seoul itinerary planner.
Return only the requested structured object.

Rules:
- Extract only constraints and preferences explicitly stated by the user. Never invent places or guess facts.
- Seoul is the only supported city. Normalize neighborhood names to Korean (e.g. 聖水/Seongsu -> 성수, 漢南/Hannam -> 한남, 西村/Seochon -> 서촌, 孔徳/Gongdeok -> 공덕, 弘大/Hongdae -> 홍대, 望遠/Mangwon -> 망원).
- Normalize interests to compact product tags where possible: cafe, shopping, culture, park, restaurant, meat. Put mood constraints such as quiet/local in preferences instead of embedding them in an interest phrase.
- Multi-Day Itineraries:
  * Parse all days into the 'days' array with Day 1, Day 2, Day 3, etc.
  * Extract specific neighborhood targets for each day into day.area (e.g. Day 1 -> "한남", Day 2 -> "성수", Day 3 -> "서촌").
  * Calculate totalDays and distribute budget across days.
- Basecamp (Hotel):
  * If a basecamp/hotel is mentioned (e.g. 롯데시티호텔 마포, 명동 호텔), extract it into baseCamp with name and dailyReturnTime (e.g. 21:30). Set startAnchor and endAnchor for each day accordingly.
- Airport (Incheon / Gimpo):
  * If an arrival/departure airport is mentioned (e.g. 인천공항 T1/T2, 김포공항), normalize to Korean (인천국제공항 제1여객터미널, 인천국제공항 제2여객터미널, 김포국제공항) and extract into airport.
  * For arrival on Day 1, set Day 1 startAnchor to the airport.
  * For departure on the final day, set the final day endAnchor to the airport.
- Fixed Appointments & Mandatory Places:
  * If the user specifies fixed reservations (e.g. 15:00 Leeum Museum, 90 mins stay, or 17:30 KSPO DOME), extract them into day.fixedAppointments with targetTime, durationMinutes, and isMandatory=true.
- Meal Windows:
  * Extract specific meal times and cuisine preferences into day.mealWindows (e.g. 18:30 dinner in Seongsu). If the user gives a meal time but no duration, use the product scheduling default of 60 minutes; durationMinutes must be 1..300.
  * Treat Korean/Japanese meal requests such as 저녁, 한식, 夕食, 韓国料理, ディナー as restaurant interests even when no exact meal time is stated. Use 18:30 for an explicitly requested dinner and 12:30 for an explicitly requested lunch when the user gives no time.
- Fixed Appointments:
  * If the user specifies an appointment time but no stay duration, use the product scheduling default of 60 minutes. Never use the schema minimum merely to fill the field.
- Mobility Constraints:
  * If the user indicates walking difficulties or wants short walks (e.g. 15 mins max, avoid stairs/hills), extract into mobilityConstraint with maxWalkMinutesPerLeg and avoidSteepInclineOrStairs=true.
  * If the user explicitly prefers subway, bus, walking, or taxi, always set mobilityConstraint.preferredTransit to subway, bus, walk, or taxi. Do not leave mobilityConstraint null merely because there is no walking difficulty.
- STRICT EXCLUSION: Michi is exclusively for Seoul metropolitan civilian tourism, culture, food, and lifestyle. NEVER extract, include, or recommend anything related to North Korea (DPRK), DMZ, Panmunjom, border/security tours, defectors, or political military division.
- Use 24-hour HH:mm. When no time is stated, default to 13:00 to 21:00.`;

@Injectable()
export class OpenAIProvider implements TripPreferenceParser {
  constructor(
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI | null,
    private readonly config: ConfigService,
    private readonly schema: TripPreferenceSchemaValidator,
  ) {}

  async parse(input: PreferenceParseInput): Promise<PreferenceParseResult> {
    if (!this.client) {
      throw new ServiceUnavailableException({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'OpenAI provider is not configured for live use',
      });
    }

    try {
      const todaySeoul = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      const explicitContextParts: string[] = [`today: ${todaySeoul} (Asia/Seoul)`];
      if (input.startDate) explicitContextParts.push(`startDate: ${input.startDate}`);
      if (input.endDate) explicitContextParts.push(`endDate: ${input.endDate}`);
      if (input.travelDate) explicitContextParts.push(`travelDate: ${input.travelDate}`);
      if (input.startTime) explicitContextParts.push(`startTime: ${input.startTime}`);
      if (input.endTime) explicitContextParts.push(`endTime: ${input.endTime}`);
      if (input.budget) explicitContextParts.push(`budget: ${input.budget}`);
      if (input.startArea) explicitContextParts.push(`startArea: ${input.startArea}`);
      const userContent =
        explicitContextParts.length > 0
          ? `[Explicit Form Constraints]\n${explicitContextParts.join('\n')}\n\n[User Natural Request]\n${input.text}`
          : input.text;

      // One parse call structures the full request. Scoring and routing never call the LLM.
      const response = await this.client.responses.parse({
        model: this.config.get<string>('OPENAI_MODEL') ?? 'gpt-5.6-luna',
        input: [
          { role: 'system', content: SYSTEM_INSTRUCTIONS },
          { role: 'user', content: userContent },
        ],
        text: {
          format: zodTextFormat(TripPreferenceOutputSchema, 'trip_preference'),
        },
      });
      if (!response.output_parsed) {
        throw new BadGatewayException({
          code: 'PROVIDER_RESPONSE_INVALID',
          message: 'OpenAI returned no structured preference output',
        });
      }

      const resolvedArea = input.startArea ?? response.output_parsed.area;
      const resolvedStartTime = input.startTime ?? response.output_parsed.startTime;
      const resolvedEndTime = input.endTime ?? response.output_parsed.endTime;
      const resolvedBudget = input.budget ?? response.output_parsed.budget;
      const resolvedStartDate =
        input.startDate ?? response.output_parsed.startDate ?? input.travelDate ?? null;
      const resolvedEndDate = input.endDate ?? response.output_parsed.endDate ?? null;

      const rawDays = response.output_parsed.days;
      const days =
        rawDays && rawDays.length > 0
          ? rawDays
          : [
              {
                dayNumber: 1,
                date: resolvedStartDate,
                title: 'Day 1',
                area: resolvedArea,
                startTime: resolvedStartTime,
                endTime: resolvedEndTime,
                dailyBudgetKrw: resolvedBudget,
                startAnchor: response.output_parsed.anchorPlace,
                endAnchor: null,
                fixedAppointments: [],
                mealWindows: [],
                mustVisitPlaces: [],
                interests: response.output_parsed.interests,
                preferences: response.output_parsed.preferences,
                avoid: response.output_parsed.avoid,
                maxWalkMinutes: response.output_parsed.maxWalkMinutes,
                anchorPlace: response.output_parsed.anchorPlace,
              },
            ];

      const preference: ParsedTripPreference = {
        ...response.output_parsed,
        startDate: resolvedStartDate,
        endDate: resolvedEndDate,
        totalDays: response.output_parsed.totalDays ?? (days.length > 0 ? days.length : 1),
        partySize: response.output_parsed.partySize ?? null,
        area: resolvedArea,
        startTime: resolvedStartTime,
        endTime: resolvedEndTime,
        budget: resolvedBudget,
        days,
      };
      return {
        preference: this.schema.validate(preference),
        parserMode: 'live',
        warnings: [],
      };
    } catch (error: unknown) {
      console.error('[OpenAIProvider error]', error);
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'OpenAI preference parsing is temporarily unavailable',
      });
    }
  }
}
