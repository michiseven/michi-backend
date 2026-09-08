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

  it('keeps an early final-day departure as a valid departure window', async () => {
    const multiDayOutput = {
      ...output,
      startDate: '2026-09-05',
      endDate: '2026-09-07',
      totalDays: 3,
      days: [
        { ...output.days[0], dayNumber: 1, date: '2026-09-05' },
        {
          ...output.days[0],
          dayNumber: 2,
          date: '2026-09-06',
          startTime: '10:30',
          endTime: '21:00',
        },
        {
          ...output.days[0],
          dayNumber: 3,
          date: '2026-09-07',
          // A model may incorrectly carry Day 1's arrival time into the departure day.
          startTime: '13:00',
          endTime: '21:00',
        },
      ],
    };
    const { provider } = providerWithResponse(multiDayOutput);

    const result = await provider.parse({
      text: '2박 3일 서울 여행',
      startDate: '2026-09-05',
      endDate: '2026-09-07',
      startTime: '13:00',
      endTime: '08:53',
      departureAirport: 'ICN_T1',
    });

    expect(result.preference.days?.[0]).toMatchObject({ dayNumber: 1, startTime: '13:00' });
    expect(result.preference.days?.[2]).toMatchObject({
      dayNumber: 3,
      startTime: '06:53',
      endTime: '08:53',
      endAnchor: { name: '인천국제공항 제1여객터미널' },
    });
  });

  it('treats the form-selected hotel as authoritative over a model-returned accommodation', async () => {
    const modelOutput = {
      ...output,
      baseCamp: {
        name: '서촌 가치 비엔비',
        checkInTime: '15:00',
        checkOutTime: '11:00',
        dailyReturnTime: '21:30',
      },
      days: [
        {
          ...output.days[0],
          startAnchor: { name: '서촌 가치 비엔비', targetTime: null, role: 'start' },
          endAnchor: { name: '서촌 가치 비엔비', targetTime: null, role: 'destination' },
          mustVisitPlaces: ['서촌 가치 비엔비', '경복궁'],
        },
      ],
    };
    const { provider, requests } = providerWithResponse(modelOutput);

    const result = await provider.parse({
      text: '명동에서 카페와 저녁 식사 일정 만들어줘.',
      hotel: '롯데호텔 서울(명동)',
    });

    expect(JSON.stringify(requests[0])).toContain('hotel: 롯데호텔 서울(명동)');
    expect(result.preference.baseCamp?.name).toBe('롯데호텔 서울(명동)');
    expect(result.preference.days?.[0]).toMatchObject({
      startAnchor: { name: '롯데호텔 서울(명동)' },
      endAnchor: { name: '롯데호텔 서울(명동)' },
      mustVisitPlaces: ['경복궁'],
    });
  });

  it('forces distinct selected arrival and departure airports onto the first and final day', async () => {
    const modelOutput = {
      ...output,
      totalDays: 2,
      startDate: '2026-09-10',
      endDate: '2026-09-11',
      days: [
        {
          ...output.days[0],
          dayNumber: 1,
          date: '2026-09-10',
          startAnchor: { name: '명동 호텔', targetTime: '13:00', role: 'start' },
        },
        {
          ...output.days[0],
          dayNumber: 2,
          date: '2026-09-11',
          endAnchor: { name: '명동 호텔', targetTime: '21:00', role: 'destination' },
        },
      ],
    };
    const { provider, requests } = providerWithResponse(modelOutput);

    const result = await provider.parse({
      text: '서울 여행 일정 만들어줘.',
      arrivalAirport: 'ICN_T2',
      departureAirport: 'GMP_INTL',
    });

    expect(JSON.stringify(requests[0])).toContain('arrivalAirport: 인천국제공항 제2여객터미널');
    expect(JSON.stringify(requests[0])).toContain('departureAirport: 김포국제공항 국제선');
    expect(result.preference.airport).toBe('인천국제공항 제2여객터미널');
    expect(result.preference.days?.[0]?.startAnchor).toMatchObject({
      name: '인천국제공항 제2여객터미널',
      role: 'start',
    });
    expect(result.preference.days?.[1]?.endAnchor).toMatchObject({
      name: '김포국제공항 국제선',
      role: 'destination',
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
