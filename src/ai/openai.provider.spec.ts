import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { TripPreferenceSchemaValidator } from '../preferences/trip-preference-schema.validator';
import { OpenAIProvider } from './openai.provider';

describe('OpenAIProvider', () => {
  const schema = new TripPreferenceSchemaValidator();
  const output = {
    tripTitle: '성수 하루 여행',
    startDate: '2026-08-29',
    endDate: '2026-08-29',
    totalDays: 1,
    totalBudgetKrw: 80_000,
    partySize: 1,
    companions: 'solo' as const,
    pace: 'relaxed' as const,
    baseCamp: null,
    mobilityConstraint: null,
    userPriorities: ['crowd_avoidance' as const],
    rainFallbackPolicy: 'indoor_switch' as const,
    area: '성수',
    startTime: '13:00',
    endTime: '21:00',
    budget: 80_000,
    interests: ['cafe' as const, 'meat' as const],
    preferences: ['quiet' as const],
    avoid: ['crowded' as const],
    maxWalkMinutes: null,
    anchorPlace: null,
    days: [
      {
        dayNumber: 1,
        date: '2026-08-29',
        title: '성수 하루 여행',
        area: '성수',
        startTime: '13:00',
        endTime: '21:00',
        dailyBudgetKrw: 80_000,
        startAnchor: null,
        endAnchor: null,
        fixedAppointments: [],
        mealWindows: [],
        mustVisitPlaces: [],
        interests: ['cafe', 'meat'],
        preferences: ['quiet'],
        avoid: ['crowded'],
        maxWalkMinutes: null,
        anchorPlace: null,
      },
    ],
  };

  function providerWithResponse(value: unknown): {
    provider: OpenAIProvider;
    requests: unknown[];
  } {
    const requests: unknown[] = [];
    const parse = (request: unknown): Promise<{ output_parsed: unknown }> => {
      requests.push(request);
      return Promise.resolve({ output_parsed: value });
    };
    const client = { responses: { parse } } as unknown as OpenAI;
    return {
      provider: new OpenAIProvider(
        client,
        new ConfigService({ OPENAI_MODEL: 'gpt-5.6-luna' }),
        schema,
      ),
      requests,
    };
  }

  it('uses one Responses API structured parse call and applies explicit overrides', async () => {
    const { provider, requests } = providerWithResponse(output);
    const result = await provider.parse({
      text: '明日、聖水で一人で遊びたい。',
      startTime: '14:00',
      budget: 60_000,
    });

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request).toBeDefined();
    if (!request || typeof request !== 'object') throw new Error('parse request missing');
    expect('model' in request && request.model).toBe('gpt-5.6-luna');
    expect('input' in request && Array.isArray(request.input)).toBe(true);
    expect('text' in request && typeof request.text === 'object').toBe(true);
    expect(result).toMatchObject({
      parserMode: 'live',
      preference: { startTime: '14:00', budget: 60_000 },
    });
  });

  it('rejects missing or invalid server-side structured output', async () => {
    await expect(
      providerWithResponse(null).provider.parse({ text: 'test' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    await expect(
      providerWithResponse({ ...output, startTime: '99:99' }).provider.parse({ text: 'test' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('does not silently run live parsing without a configured client', async () => {
    const provider = new OpenAIProvider(
      null,
      new ConfigService({ OPENAI_MODEL: 'gpt-5.6-luna' }),
      schema,
    );
    await expect(provider.parse({ text: 'test' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
