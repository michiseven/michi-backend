import { BadRequestException } from '@nestjs/common';
import { MockTripPreferenceParser } from './mock-trip-preference.parser';
import { PreferencesService } from './preferences.service';
import { TripPreferenceSchemaValidator } from './trip-preference-schema.validator';
import type { TripPreferenceParser } from './preference-parser';
import { HeuristicRouteOptimizer } from '../recommendation/heuristic-route-optimizer';
import type { RankedCandidate } from '../recommendation/ports';

describe('PreferencesService', () => {
  it.each(['13~18시', '13〜18時', '13시부터18시까지'])(
    'fits an inferred western dinner inside the hard Hongdae window %s',
    async (range) => {
      const schema = new TripPreferenceSchemaValidator();
      const service = new PreferencesService(new MockTripPreferenceParser(schema), schema);
      const result = await service.parse({
        text: `홍대에서 친구 3명과 토요일 ${range}에 카페와 저녁을 즐기고 싶어요.`,
        mealCuisine: 'western',
      });
      expect(result.preference).toMatchObject({
        area: '홍대',
        startTime: '13:00',
        endTime: '18:00',
      });
      const day = result.preference.days![0]!;
      expect(day).toMatchObject({ area: '홍대', startTime: '13:00', endTime: '18:00' });
      expect(day.mealWindows).toEqual([
        expect.objectContaining({
          mealType: 'dinner',
          targetTime: '16:30',
          durationMinutes: 90,
          cuisinePreferences: ['양식'],
        }),
      ]);
    },
  );
  it('preserves an explicitly conflicting dinner clock for feasibility rejection', async () => {
    const schema = new TripPreferenceSchemaValidator();
    const service = new PreferencesService(new MockTripPreferenceParser(schema), schema);
    const result = await service.parse({
      text: '홍대에서13~18시 카페, 저녁18:30에 양식',
      mealCuisine: 'western',
    });
    expect(result.preference.endTime).toBe('18:00');
    expect(result.preference.days![0]!.mealWindows![0]!.targetTime).toBe('18:30');
  });
  it('does not mistake the final bound of a compact range for an explicit dinner time', async () => {
    const schema = new TripPreferenceSchemaValidator();
    const service = new PreferencesService(new MockTripPreferenceParser(schema), schema);
    const result = await service.parse({ text: '홍대13~18시 저녁양식', mealCuisine: 'western' });
    expect(result.preference.days![0]!.mealWindows![0]!.targetTime).toBe('16:30');
  });
  it.each([
    ['홍대13~18시 카페, 17시에 저녁 양식', '17:00', 60],
    ['홍대13~18시 카페, 17시에90분저녁 양식', '17:00', 90],
    ['홍대13~18시 카페, 18:30에저녁 양식', '18:30', 60],
    ['토요일 홍대에서13시부터18시까지카페와양식저녁. 저녁은17시에90분동안먹을거야.', '17:00', 90],
    [
      '토요일 홍대에서 13시부터 18시까지 카페와 양식 저녁을 즐기고 싶어요. 저녁은 17시에 90분 동안 먹을 거야.',
      '17:00',
      90,
    ],
    ['홍대13~18시 카페, 17시에저녁을90분동안먹을거야', '17:00', 90],
    ['弘大13〜18時 カフェ。夕食は17時に90分間食べたい', '17:00', 90],
    ['홍대13~18시 카페에서90분, 저녁은17시', '17:00', 60],
  ])('preserves explicit meal timing in %s', async (text, targetTime, durationMinutes) => {
    const schema = new TripPreferenceSchemaValidator();
    const service = new PreferencesService(new MockTripPreferenceParser(schema), schema);
    const result = await service.parse({ text, mealCuisine: 'western' });
    expect(result.preference.days![0]!).toMatchObject({
      endTime: '18:00',
      mealWindows: [expect.objectContaining({ targetTime, durationMinutes })],
    });
    const day = result.preference.days![0]!;
    const candidates: RankedCandidate[] = ['cafe', 'restaurant'].map((category, index) => ({
      place: {
        placeId: category,
        source: 'fixture',
        sourcePlaceId: category,
        name: category,
        category,
        address: '서울 홍대',
        roadAddress: null,
        district: '마포구',
        rawCategory: category,
        location: { type: 'Point', coordinates: [126.924 + index * 0.001, 37.557] },
        rawPayload: {},
      },
      estimatedStayMinutes: 60,
      estimatedCost: null,
      reason: 'fixture',
      scoreBreakdown: {
        total: 1,
        preference: 1,
        crowd: 1,
        distance: 1,
        time: 1,
        budget: 1,
        diversity: 1,
        area: 1,
      },
    }));
    const route = new HeuristicRouteOptimizer().optimize({
      travelDate: day.date!,
      startTime: day.startTime,
      endTime: day.endTime,
      budget: null,
      candidates,
      mealWindows: day.mealWindows,
      requiredActivityCounts: { cafe: 1, restaurant: 1 },
    });
    expect(route).toHaveLength(targetTime === '17:00' && durationMinutes === 60 ? 2 : 0);
  });
  it('does not flatten distinct multi-day boundary times into a single activity range', async () => {
    const schema = new TripPreferenceSchemaValidator();
    const service = new PreferencesService(new MockTripPreferenceParser(schema), schema);
    const result = await service.parse({
      text: '성수 카페 13시부터16시까지',
      startDate: '2026-12-01',
      endDate: '2026-12-02',
      startTime: '11:00',
      endTime: '20:30',
    });
    expect(result.preference.totalDays).toBe(2);
    expect(result.preference.days?.[0]?.startTime).toBe('11:00');
    expect(result.preference.days?.[1]?.endTime).toBe('20:30');
  });
  it('never expands explicit 13–16 tourism to flight20:30 or checkout11', async () => {
    const schema = new TripPreferenceSchemaValidator();
    const service = new PreferencesService(new MockTripPreferenceParser(schema), schema);
    const result = await service.parse({
      text: '토요일 성수에서13시부터16시까지 카페. 호텔11시 체크아웃. 캐리어1개 보관 후 회수, 인천공항20:30비행기여서18시까지 공항에 도착해야 해. 터미널은 몰라. 한국어로 답해줘',
      startTime: '11:00',
      endTime: '20:30',
    });
    expect(result.preference).toMatchObject({ startTime: '13:00', endTime: '16:00' });
    expect(result.preference.days?.[0]).toMatchObject({ startTime: '13:00', endTime: '16:00' });
  });
  it('preserves Saturday and scoped budget when model omits natural conditions', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-30T18:00:00Z'));
    try {
      const schema = new TripPreferenceSchemaValidator();
      const service = new PreferencesService(new MockTripPreferenceParser(schema), schema);
      const result = await service.parse({
        text: '토요일 성수에서 3명 가족 여행, 1인당 2만원',
        startDate: '2026-10-01',
        partySize: 1,
        budget: 20_000,
        budgetScope: 'total',
      });
      expect(result.preference).toMatchObject({
        startDate: '2026-10-03',
        partySize: 3,
        totalBudgetKrw: 60_000,
      });
      expect(result.preference.days?.[0]?.date).toBe('2026-10-03');
    } finally {
      jest.useRealTimers();
    }
  });
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

  it('keeps a generic walk distinct from park while preserving an explicit Hanok category', async () => {
    const walk = await service.parse({
      text: '홍대에서 13시부터 18시까지 점심 먹고 카페와 산책하고 싶어.',
    });
    expect(walk.preference.interests).not.toContain('park');
    expect(walk.preference.interests).toContain('stroll');
    expect(walk.preference.days?.[0]?.interests).not.toContain('park');
    expect(walk.preference.days?.[0]?.interests).toContain('stroll');

    const hanok = await service.parse({ text: '반드시 한옥을 포함한 북촌 일정 짜줘.' });
    expect(hanok.preference.days?.[0]?.preferences).toContain('한옥');
  });

  it('does not turn a dislike of walking into the stroll activity', async () => {
    const result = await service.parse({
      text: '홍대에서 걷기 싫어. 카페만 가고 싶어.',
    });

    expect(result.preference.interests).not.toContain('stroll');
    expect(result.preference.days?.[0]?.interests).not.toContain('stroll');

    const japanese = await service.parse({ text: '散歩が苦手なので、静かなカフェに行きたい。' });
    expect(japanese.preference.interests).not.toContain('stroll');

    const dislike = await service.parse({ text: '산책을 좋아하지 않아. 카페에 가고 싶어.' });
    expect(dislike.preference.interests).not.toContain('stroll');
  });

  it('applies a structured cuisine choice to the original Hongdae lunch without inventing dinner', async () => {
    const result = await service.parse({
      text: '홍대에서 13시부터 18시까지 친구들과 점심 먹고 카페와 산책하고 싶어.',
      mealCuisine: 'korean',
    });
    const day = result.preference.days?.[0];
    expect(day).toMatchObject({ area: '홍대', startTime: '13:00', endTime: '18:00' });
    expect(day?.interests).toContain('cafe');
    expect(day?.mealWindows).toEqual([
      expect.objectContaining({
        mealType: 'lunch',
        targetTime: '13:00',
        cuisinePreferences: ['한식'],
      }),
    ]);
  });

  it('treats a cafe-dessert clarification as the meal role instead of requiring a restaurant too', async () => {
    const result = await service.parse({
      text: '홍대에서 친구 3명과 토요일 13~18시에 카페와 저녁을 즐기고 싶어요.',
      mealCuisine: 'cafe_dessert',
    });
    const day = result.preference.days?.[0];

    expect(day?.mealWindows).toEqual([
      expect.objectContaining({
        mealType: 'dinner',
        cuisinePreferences: ['카페디저트'],
      }),
    ]);
    expect(day?.interests).toContain('cafe');
    expect(day?.interests).not.toContain('restaurant');
  });

  it('keeps local specialty meal delegation out of required interests', async () => {
    const result = await service.parse({
      text: '홍대에서 13시부터 18시까지 점심 먹고 카페와 산책하고 싶어.',
      mealPreference: 'local_specialty',
    });
    const day = result.preference.days?.[0];

    expect(result.preference.interests).not.toContain('local');
    expect(day?.interests).toEqual(expect.arrayContaining(['cafe', 'stroll', 'restaurant']));
    expect(day?.interests).not.toContain('local');
    expect(day?.mealWindows?.[0]?.cuisinePreferences).toEqual([]);
  });

  it('preserves vegan restrictions when delegating the meal choice', async () => {
    const result = await service.parse({
      text: '홍대에서 비건 점심을 먹고 싶어',
      mealPreference: 'local_specialty',
    });
    expect(result.preference.days?.[0]?.mealWindows?.[0]?.cuisinePreferences).toContain('비건');
  });

  it('repairs an inferred default window that would otherwise exclude an explicit dinner', async () => {
    const parser: TripPreferenceParser = {
      parse: jest.fn().mockResolvedValue({
        parserMode: 'live',
        warnings: [],
        preference: {
          tripTitle: '연남동 저녁',
          startDate: '2026-09-11',
          endDate: '2026-09-11',
          totalDays: 1,
          totalBudgetKrw: 60_000,
          partySize: 1,
          area: '연남동',
          startTime: '13:00',
          endTime: '17:00',
          budget: 60_000,
          companions: 'solo',
          pace: 'balanced',
          baseCamp: null,
          mobilityConstraint: null,
          userPriorities: [],
          rainFallbackPolicy: null,
          interests: ['restaurant'],
          preferences: ['local'],
          avoid: [],
          maxWalkMinutes: null,
          anchorPlace: null,
          days: [
            {
              dayNumber: 1,
              date: '2026-09-11',
              title: '연남동 저녁',
              area: '연남동',
              startTime: '13:00',
              endTime: '17:00',
              interests: ['restaurant'],
              preferences: ['local'],
              avoid: [],
              dailyBudgetKrw: 60_000,
              startAnchor: null,
              endAnchor: null,
              fixedAppointments: [],
              mustVisitPlaces: [],
              maxWalkMinutes: null,
              anchorPlace: null,
              mealWindows: [
                {
                  mealType: 'dinner',
                  targetTime: '18:30',
                  durationMinutes: 60,
                  cuisinePreferences: [],
                  area: null,
                },
              ],
            },
          ],
        },
      }),
    };
    const liveService = new PreferencesService(parser, schema);

    const result = await liveService.parse({ text: '延南洞でローカルらしい夕食を食べたい。' });

    expect(result.preference.days?.[0]?.endTime).toBe('20:30');
  });

  it('keeps user-stated visitable themes when a live parser only returns broad categories', async () => {
    const parser: TripPreferenceParser = {
      parse: jest.fn().mockResolvedValue({
        parserMode: 'live',
        warnings: [],
        preference: {
          tripTitle: '서촌 여행',
          startDate: '2026-09-11',
          endDate: '2026-09-11',
          totalDays: 1,
          totalBudgetKrw: 60_000,
          partySize: 1,
          area: '서촌',
          startTime: '13:00',
          endTime: '17:00',
          budget: 60_000,
          companions: 'solo',
          pace: 'balanced',
          baseCamp: null,
          mobilityConstraint: null,
          userPriorities: [],
          rainFallbackPolicy: null,
          interests: ['cafe'],
          preferences: [],
          avoid: [],
          maxWalkMinutes: null,
          anchorPlace: null,
          days: [
            {
              dayNumber: 1,
              date: '2026-09-11',
              title: '서촌 여행',
              area: '서촌',
              startTime: '13:00',
              endTime: '17:00',
              interests: ['cafe'],
              preferences: [],
              avoid: [],
              dailyBudgetKrw: 60_000,
              startAnchor: null,
              endAnchor: null,
              fixedAppointments: [],
              mealWindows: [],
              mustVisitPlaces: [],
              maxWalkMinutes: null,
              anchorPlace: null,
            },
          ],
        },
      }),
    };
    const liveService = new PreferencesService(parser, schema);

    const result = await liveService.parse({ text: '西村で韓屋カフェと伝統工芸を見たい。' });

    expect(result.preference.days?.[0]?.preferences).toEqual(
      expect.arrayContaining(['한옥', '전통']),
    );
  });

  it('preserves an exact party size and normalizes a per-person budget for ranking', async () => {
    const result = await service.parse({
      text: '성수에서 친구들과 카페 갈래',
      startArea: '성수',
      partySize: 4,
      companions: 'friends',
      pace: 'standard',
      budget: 30_000,
      budgetScope: 'per_person',
    });

    expect(result.preference).toMatchObject({
      partySize: 4,
      companions: 'friends',
      pace: 'balanced',
      budget: 120_000,
      totalBudgetKrw: 120_000,
    });
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
    jest.useFakeTimers().setSystemTime(new Date('2026-08-01T00:00:00+09:00'));
    try {
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
    } finally {
      jest.useRealTimers();
    }
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

  it('accepts a multi-day trip whose final-day departure time is earlier than day-one arrival', async () => {
    const result = await service.parse({
      text: '2박 3일 서울 여행',
      startDate: '2026-10-10',
      endDate: '2026-10-12',
      startTime: '13:00',
      endTime: '10:00',
    });

    expect(result.preference).toMatchObject({
      startDate: '2026-10-10',
      endDate: '2026-10-12',
      startTime: '13:00',
      endTime: '10:00',
    });
  });

  it('uses airport anchors only when the form supplies an explicit direction', async () => {
    const directed = await service.parse({
      text: '2일 서울 여행',
      startDate: '2026-10-05',
      endDate: '2026-10-06',
      arrivalAirport: 'ICN_T1',
      departureAirport: 'GMP_INTL',
    });
    expect(directed.preference.days?.[0]?.startAnchor?.name).toBe('인천국제공항 제1여객터미널');
    expect(directed.preference.days?.[1]?.endAnchor?.name).toBe('김포국제공항 국제선');

    const ambiguous = await service.parse({
      text: '인천공항을 이용하는 2일 서울 여행',
      startDate: '2026-10-05',
      endDate: '2026-10-06',
    });
    expect(ambiguous.preference.days?.[0]?.startAnchor).toBeNull();
    expect(ambiguous.preference.days?.[1]?.endAnchor).toBeNull();
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
