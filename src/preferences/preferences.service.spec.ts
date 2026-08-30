import { BadRequestException } from '@nestjs/common';
import { MockTripPreferenceParser } from './mock-trip-preference.parser';
import { PreferencesService } from './preferences.service';
import { TripPreferenceSchemaValidator } from './trip-preference-schema.validator';
import type { TripPreferenceParser } from './preference-parser';

describe('PreferencesService', () => {
  const schema = new TripPreferenceSchemaValidator();
  const service = new PreferencesService(new MockTripPreferenceParser(schema), schema);

  it('parses Japanese time, budget, preferences, and normalizes an explicit Seoul alias', async () => {
    const result = await service.parse({
      text: '13時から21時、一人で静かなカフェに行きたい。人混みは本当に嫌。予算は8万ウォン。',
      startArea: '聖水',
    });

    expect(result.preference).toMatchObject({
      area: '성수',
      startTime: '13:00',
      endTime: '21:00',
      budget: 80_000,
      companions: 'solo',
      interests: ['cafe'],
      preferences: ['quiet'],
      avoid: ['very_crowded'],
    });
    expect(result.parserMode).toBe('mock');
  });

  it('rejects an explicit non-Seoul area', async () => {
    await expect(
      service.parse({ text: 'カフェに行きたい', startArea: '釜山' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes Japanese museum requests to the culture interest in mock mode', async () => {
    const result = await service.parse({ text: '静かな博物館と美術館を巡りたい' });

    expect(result.preference.interests).toEqual(['culture']);
  });

  it('parses walking constraint and sets long_walk avoid tag and maxWalkMinutes', async () => {
    const resultKo = await service.parse({
      text: '다리 아파서 많이 못 걸어요. 공덕 근처 조용한 카페 추천해줘.',
    });
    expect(resultKo.preference.avoid).toContain('long_walk');
    expect(resultKo.preference.maxWalkMinutes).toBe(7);

    const resultJa = await service.parse({
      text: '足が痛いのであまり歩きたくない。聖水でカフェに行きたい。',
    });
    expect(resultJa.preference.avoid).toContain('long_walk');
    expect(resultJa.preference.maxWalkMinutes).toBe(7);
  });

  it('parses concert venue and sets anchorPlace and inferred area', async () => {
    const result = await service.parse({
      text: '18時にKSPO DOMEでコンサートがあるから、その前にカフェに行きたい。',
    });
    expect(result.preference.anchorPlace).toEqual({
      name: 'KSPO DOME',
      targetTime: '18:00',
      role: 'destination',
    });
    expect(result.preference.area).toBe('송파');
    expect(result.preference.endTime).toBe('18:00');
  });

  it('prioritizes explicit startDate and endDate and generates 3-day sequential dates', async () => {
    const result = await service.parse({
      text: '2박 3일 서울 여행 가고 싶어',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      startTime: '13:00',
      endTime: '20:30',
      startArea: '공덕',
      budget: 240000,
    });

    expect(result.preference.startDate).toBe('2026-09-01');
    expect(result.preference.endDate).toBe('2026-09-03');
    expect(result.preference.totalDays).toBe(3);
    expect(result.preference.days).toHaveLength(3);
    expect(result.preference.days![0]!.dayNumber).toBe(1);
    expect(result.preference.days![0]!.date).toBe('2026-09-01');
    expect(result.preference.days![0]!.startTime).toBe('13:00');
    expect(result.preference.days![1]!.dayNumber).toBe(2);
    expect(result.preference.days![1]!.date).toBe('2026-09-02');
    expect(result.preference.days![2]!.dayNumber).toBe(3);
    expect(result.preference.days![2]!.date).toBe('2026-09-03');
    expect(result.preference.days![2]!.endTime).toBe('20:30');
  });

  it('rejects invalid time window where startTime >= endTime', async () => {
    await expect(
      service.parse({
        text: '서울 여행',
        startTime: '21:00',
        endTime: '13:00',
      }),
    ).rejects.toThrow();
  });

  it('deterministically preserves explicit transit, meal, area anchor, and appointment defaults omitted by the LLM', async () => {
    const parser: TripPreferenceParser = {
      parse: jest.fn().mockResolvedValue({
        parserMode: 'live',
        warnings: [],
        preference: {
          tripTitle: '공덕 하루 여행',
          startDate: '2026-08-25',
          endDate: '2026-08-25',
          totalDays: 1,
          totalBudgetKrw: 80000,
          partySize: 1,
          companions: 'solo',
          pace: 'relaxed',
          baseCamp: null,
          userPriorities: ['short_transit'],
          rainFallbackPolicy: null,
          area: '공덕',
          startTime: '13:00',
          endTime: '21:00',
          budget: 80000,
          interests: ['cafe'],
          preferences: ['지하철 우선'],
          avoid: [],
          maxWalkMinutes: null,
          anchorPlace: { name: '공덕', targetTime: null, role: 'start' },
          mobilityConstraint: null,
          days: [
            {
              dayNumber: 1,
              date: '2026-08-25',
              title: '공덕 하루 여행',
              area: '공덕',
              startTime: '13:00',
              endTime: '21:00',
              dailyBudgetKrw: 80000,
              startAnchor: { name: '공덕', targetTime: null, role: 'start' },
              endAnchor: null,
              fixedAppointments: [
                {
                  name: '리움미술관',
                  targetTime: '15:00',
                  durationMinutes: 1,
                  isMandatory: true,
                  category: 'culture',
                },
              ],
              mealWindows: [
                {
                  mealType: 'dinner',
                  targetTime: '18:30',
                  durationMinutes: 60,
                  cuisinePreferences: ['한국料理'],
                  area: null,
                },
              ],
              mustVisitPlaces: ['리움미술관'],
              interests: ['cafe', 'culture'],
              preferences: ['지하철 우선'],
              avoid: [],
              maxWalkMinutes: null,
              anchorPlace: { name: '공덕', targetTime: null, role: 'start' },
            },
          ],
        },
      }),
    };
    const liveService = new PreferencesService(parser, schema);

    const result = await liveService.parse({
      text: '今日は孔徳から出発します。15時にリウム美術館を必ず訪問します。夕食は韓国料理を食べ、地下鉄を優先したいです。場所間の移動は15分以内が理想です。',
      startArea: '공덕',
      travelDate: '2026-08-25',
    });

    expect(result.preference.mobilityConstraint).toMatchObject({
      preferredTransit: 'subway',
      maxWalkMinutesPerLeg: 25,
      avoidSteepInclineOrStairs: false,
    });
    expect(result.preference.anchorPlace).toBeNull();
    expect(result.preference.interests).toContain('restaurant');
    expect(result.preference.days![0]).toMatchObject({
      anchorPlace: null,
      mealWindows: [
        {
          mealType: 'dinner',
          targetTime: '18:30',
          durationMinutes: 60,
          cuisinePreferences: ['한식'],
        },
      ],
      fixedAppointments: [
        {
          name: '리움미술관',
          targetTime: '15:00',
          durationMinutes: 60,
          isMandatory: true,
        },
      ],
    });
  });

  it('preserves a fixed appointment stay duration explicitly stated by the user', async () => {
    const parser = {
      parse: jest.fn().mockResolvedValue({
        parserMode: 'live',
        warnings: [],
        preference: {
          tripTitle: '한남 여행',
          startDate: '2026-08-26',
          endDate: '2026-08-26',
          totalDays: 1,
          totalBudgetKrw: 80000,
          partySize: 1,
          companions: 'solo',
          pace: 'relaxed',
          baseCamp: null,
          userPriorities: ['must_visit'],
          rainFallbackPolicy: null,
          area: '한남',
          startTime: '13:00',
          endTime: '21:00',
          budget: 80000,
          interests: ['culture'],
          preferences: [],
          avoid: [],
          maxWalkMinutes: null,
          anchorPlace: null,
          mobilityConstraint: null,
          days: [
            {
              dayNumber: 1,
              date: '2026-08-26',
              title: '한남 여행',
              area: '한남',
              startTime: '13:00',
              endTime: '21:00',
              dailyBudgetKrw: 80000,
              startAnchor: null,
              endAnchor: null,
              fixedAppointments: [
                {
                  name: '리움미술관',
                  targetTime: '15:00',
                  durationMinutes: 90,
                  isMandatory: true,
                  category: 'culture',
                },
              ],
              mealWindows: [],
              mustVisitPlaces: ['리움미술관'],
              interests: ['culture'],
              preferences: [],
              avoid: [],
              maxWalkMinutes: null,
              anchorPlace: null,
            },
          ],
        },
      }),
    } satisfies TripPreferenceParser;

    const result = await new PreferencesService(parser, schema).parse({
      text: '15時にリウム美術館を訪問して90分滞在したいです。',
      startArea: '한남',
      travelDate: '2026-08-26',
    });

    expect(result.preference.days![0]!.fixedAppointments![0]!.durationMinutes).toBe(90);
  });
});
