import type {
  Place,
  RecommendationResult,
  Trip,
  TripPreference,
  TripStop,
} from '../database/entities';
import { toTripDto } from './trip-response';

function dtoAirportRoles(dto: ReturnType<typeof toTripDto>): string[] {
  return (dto.airportTransfers ?? []).map((transfer) => transfer.role);
}

describe('trip API response', () => {
  it('returns map-safe coordinates, HH:mm values, crowd level, and applied weights', () => {
    const place = {
      id: 'place-id',
      name: '장소',
      category: 'cafe',
      address: null,
      roadAddress: '서울특별시 성동구 서울숲길 1',
      location: { type: 'Point', coordinates: [127.0436, 37.5467] },
    } as unknown as Place;
    const stop = {
      id: 'stop-id',
      order: 1,
      placeId: place.id,
      place,
      arrivalAt: new Date('2026-08-18T04:00:00.000Z'),
      leaveAt: new Date('2026-08-18T05:00:00.000Z'),
      estimatedStayMinutes: 60,
      estimatedCost: null,
      reason: '理由',
      crowdContext: {
        provider: 'seoul-open-data',
        providerMode: 'live',
        scope: 'area',
        areaName: '성수카페거리',
        congestionLevel: '보통',
        observedAt: '2026-08-18T12:55:00+09:00',
        disclaimer: '특정 장소 내부 혼잡도가 아닙니다.',
      },
      scoreBreakdown: {
        total: 0.8,
        preference: 1,
        crowd: 0.7,
        distance: 0.5,
        time: 1,
        budget: 0.5,
        diversity: 0.5,
        area: 1,
      },
    } as TripStop;
    const trip = {
      id: 'trip-id',
      status: 'ready',
      travelDate: '2026-08-18',
      startTime: '13:00:00',
      endTime: '21:00:00',
      budgetKrw: 80_000,
      totalEstimatedCost: null,
      preference: {
        parserMode: 'mock',
        validatedJson: { area: '성수' },
      } as unknown as TripPreference,
      recommendationResult: {
        finalWeights: { preference: 0.35, crowd: 0.2 },
      } as unknown as RecommendationResult,
      stops: [stop],
    } as unknown as Trip;

    expect(toTripDto(trip)).toMatchObject({
      appliedWeights: { preference: 0.35, crowd: 0.2 },
      stops: [
        {
          latitude: 37.5467,
          longitude: 127.0436,
          arrivalAt: '13:00',
          leaveAt: '14:00',
          crowd: { level: '보통', scope: 'area' },
        },
      ],
    });
  });

  it('represents explicit arrival and departure airports once as boundaries, never visit stops', () => {
    const airport = {
      id: 'airport-id',
      source: 'official_airport',
      sourcePlaceId: 'ICN_T1',
      name: '인천국제공항 제1여객터미널',
      category: 'airport',
      location: { type: 'Point', coordinates: [126.4505, 37.4485] },
    } as unknown as Place;
    const cafe = {
      id: 'cafe-id',
      source: 'mock',
      name: '홍대 카페',
      category: 'cafe',
      location: { type: 'Point', coordinates: [126.923, 37.556] },
    } as unknown as Place;
    const makeStop = (place: Place, order: number, stopType: 'airport' | 'general'): TripStop =>
      ({
        id: `${place.id}-stop`,
        order,
        stopType,
        placeId: place.id,
        place,
        arrivalAt: new Date('2026-09-05T00:00:00.000Z'),
        leaveAt: new Date('2026-09-05T01:00:00.000Z'),
        estimatedStayMinutes: 60,
        estimatedCost: null,
        reason: 'fixture',
        scoreBreakdown: { total: 0.8 },
      }) as TripStop;
    const trip = {
      id: 'airport-boundary-trip',
      status: 'ready',
      travelDate: '2026-09-05',
      startTime: '08:20:00',
      endTime: '19:00:00',
      budgetKrw: null,
      totalEstimatedCost: null,
      preference: {
        validatedJson: {
          locale: 'ko',
          arrivalAirport: 'ICN_T1',
          departureAirport: 'GMP_INTL',
          totalDays: 2,
          days: [
            { dayNumber: 1, date: '2026-09-05', startTime: '08:20', endTime: '19:00' },
            { dayNumber: 2, date: '2026-09-06', startTime: '10:00', endTime: '18:30' },
          ],
        },
      },
      recommendationResult: { finalWeights: {} },
      stops: [makeStop(airport, 1, 'airport'), makeStop(cafe, 2, 'general')],
    } as unknown as Trip;

    const dto = toTripDto(trip);

    expect(dto.stops).toHaveLength(1);
    expect(dto.stops[0]?.placeName).toBe('홍대 카페');
    expect(dto.airportTransfers?.[0]).toMatchObject({
      role: 'arrival',
      appliesOn: 'first_day',
      dayNumber: 1,
      date: '2026-09-05',
      at: '08:20',
      airport: { code: 'ICN_T1' },
      transfer: { status: 'unavailable', durationMinutes: null },
    });
    expect(dto.airportTransfers?.[1]).toMatchObject({
      role: 'departure',
      appliesOn: 'last_day',
      dayNumber: 2,
      date: '2026-09-06',
      at: '18:30',
      airport: { code: 'GMP_INTL' },
      bufferMinutes: null,
    });
  });

  it.each([
    ['arrival only', { arrivalAirport: 'ICN_T2' }, ['arrival']],
    ['departure only', { departureAirport: 'GMP_DOM' }, ['departure']],
    ['ambiguous legacy airport', { airport: 'ICN_T1' }, []],
  ])('does not duplicate airport boundaries for %s', (_scenario, airportInput, roles) => {
    const trip = {
      id: 'airport-role-trip',
      status: 'ready',
      travelDate: '2026-09-05',
      startTime: '08:20:00',
      endTime: '19:00:00',
      budgetKrw: null,
      totalEstimatedCost: null,
      preference: {
        validatedJson: {
          ...airportInput,
          totalDays: 2,
          days: [
            { dayNumber: 1, date: '2026-09-05', startTime: '08:20', endTime: '19:00' },
            { dayNumber: 2, date: '2026-09-06', startTime: '10:00', endTime: '18:30' },
          ],
        },
      },
      recommendationResult: { finalWeights: {} },
      stops: [],
    } as unknown as Trip;

    expect(dtoAirportRoles(toTripDto(trip))).toEqual(roles);
  });

  it('fails fast if persisted stop coordinates violate the wire contract', () => {
    const trip = {
      id: 'trip-id',
      status: 'ready',
      travelDate: '2026-08-18',
      startTime: '13:00:00',
      endTime: '21:00:00',
      budgetKrw: null,
      totalEstimatedCost: null,
      preference: { validatedJson: {} },
      recommendationResult: { finalWeights: {} },
      stops: [
        {
          id: 'stop-id',
          order: 1,
          placeId: 'place-id',
          place: { id: 'place-id', name: '좌표 없음', category: null, location: null },
        },
      ],
    } as Trip;
    expect(() => toTripDto(trip)).toThrow('without coordinates');
  });

  it('maps trip-level and stop-level explanation to TripDto', () => {
    const place = {
      id: 'place-id',
      name: '성수 카페',
      category: 'cafe',
      roadAddress: '서울특별시 성동구 서울숲길 1',
      location: { type: 'Point', coordinates: [127.0436, 37.5467] },
    } as Place;

    const stop = {
      id: 'stop-id',
      order: 1,
      placeId: place.id,
      place,
      arrivalAt: new Date('2026-08-18T04:00:00.000Z'),
      leaveAt: new Date('2026-08-18T05:00:00.000Z'),
      estimatedStayMinutes: 60,
      estimatedCost: 10000,
      reason: '추천 이유',
      scoreBreakdown: { total: 0.9 },
      explanation: {
        shortDescription: '성수 카페 소개',
        previousStopFit: null,
        nextStopFit: null,
        overallTripFit: '전체 일정에 부합',
      },
    } as TripStop;

    const trip = {
      id: 'trip-id',
      status: 'ready',
      travelDate: '2026-08-18',
      startTime: '13:00:00',
      endTime: '21:00:00',
      preference: { validatedJson: {} } as unknown as TripPreference,
      recommendationResult: {
        finalWeights: {},
        explanation: {
          tripSummary: '전체 여행 요약',
          locale: 'ko',
          mode: 'live',
          model: 'gpt-5.6-luna',
        },
      } as unknown as RecommendationResult,
      stops: [stop],
    } as Trip;

    const dto = toTripDto(trip);
    expect(dto.explanation).toEqual({
      tripSummary: '전체 여행 요약',
      locale: 'ko',
      mode: 'live',
      model: 'gpt-5.6-luna',
    });
    expect(dto.stops[0]?.explanation).toEqual({
      shortDescription: '성수 카페 소개',
      previousStopFit: null,
      nextStopFit: null,
      overallTripFit: '전체 일정에 부합',
    });
  });

  it('returns a verified Korean display name without changing the provider record', () => {
    const place = {
      id: 'place-id',
      name: '[MOCK] 焼肉店',
      category: 'restaurant',
      location: { type: 'Point', coordinates: [127.0436, 37.5467] },
    } as Place;
    const trip = {
      id: 'trip-id',
      status: 'ready',
      travelDate: '2026-08-18',
      startTime: '13:00:00',
      endTime: '21:00:00',
      budgetKrw: null,
      totalEstimatedCost: null,
      preference: { validatedJson: { locale: 'ko' } } as unknown as TripPreference,
      recommendationResult: { finalWeights: {} } as RecommendationResult,
      stops: [
        {
          id: 'stop-id',
          order: 1,
          placeId: place.id,
          place,
          arrivalAt: new Date('2026-08-18T04:00:00.000Z'),
          leaveAt: new Date('2026-08-18T05:00:00.000Z'),
          estimatedStayMinutes: 60,
          estimatedCost: null,
          reason: '추천 이유',
          scoreBreakdown: { total: 0.8 },
        } as TripStop,
      ],
    } as Trip;

    expect(toTripDto(trip).stops[0]?.placeName).toBe('[MOCK] 고깃집');
    expect(place.name).toBe('[MOCK] 焼肉店');
  });

  it('exposes only a validated Kakao place detail URL and normalizes it to HTTPS', () => {
    const place = {
      id: 'kakao-place-id',
      source: 'kakao-local',
      name: '카카오 장소',
      category: 'cafe',
      location: { type: 'Point', coordinates: [126.951, 37.544] },
      rawPayload: {
        sourceRecord: { place_url: 'http://place.map.kakao.com/123456' },
      },
    } as unknown as Place;
    const trip = {
      id: 'trip-id',
      status: 'ready',
      travelDate: '2026-08-27',
      startTime: '13:00:00',
      endTime: '21:00:00',
      preference: { validatedJson: { locale: 'ko' } },
      recommendationResult: { finalWeights: {} },
      stops: [
        {
          id: 'stop-id',
          order: 1,
          placeId: place.id,
          place,
          arrivalAt: new Date('2026-08-27T04:00:00.000Z'),
          leaveAt: new Date('2026-08-27T05:00:00.000Z'),
          estimatedStayMinutes: 60,
          estimatedCost: null,
          reason: '추천 이유',
          scoreBreakdown: { total: 0.8 },
        },
      ],
    } as unknown as Trip;

    expect(toTripDto(trip).stops[0]?.placeDetailLink).toEqual({
      provider: 'kakao-map',
      url: 'https://place.map.kakao.com/123456',
    });
  });

  it('does not expose a legacy category benchmark as a verified place price', () => {
    const place = {
      id: 'legacy-price-place',
      name: '가격 미확인 카페',
      category: 'cafe',
      location: { type: 'Point', coordinates: [127.0436, 37.5467] },
      priceEvidence: {
        source: 'benchmark-prior',
        averageCostKrw: 8_000,
        lastFetchedAt: '2026-08-27T00:00:00.000Z',
      },
    } as unknown as Place;
    const trip = {
      id: 'trip-id',
      status: 'ready',
      travelDate: '2026-08-28',
      startTime: '13:00:00',
      endTime: '21:00:00',
      preference: { validatedJson: { locale: 'ko' } },
      recommendationResult: { finalWeights: {} },
      stops: [
        {
          id: 'stop-id',
          order: 1,
          placeId: place.id,
          place,
          arrivalAt: new Date('2026-08-28T04:00:00.000Z'),
          leaveAt: new Date('2026-08-28T05:00:00.000Z'),
          estimatedStayMinutes: 60,
          estimatedCost: 8_000,
          reason: '추천 이유',
          scoreBreakdown: { total: 0.8 },
        },
      ],
    } as unknown as Trip;

    expect(toTripDto(trip).stops[0]).not.toHaveProperty('estimatedCost');
    expect(toTripDto(trip).stops[0]).not.toHaveProperty('priceEvidence');
  });

  it('keeps safety requests unverified without place-level provider evidence', () => {
    const place = {
      id: 'place-id',
      name: '검증 없는 장소',
      category: 'restaurant',
      location: { type: 'Point', coordinates: [127.0436, 37.5467] },
    } as unknown as Place;
    const trip = {
      id: 'trip-id',
      status: 'ready',
      travelDate: '2026-09-05',
      startTime: '13:00:00',
      endTime: '18:00:00',
      preference: {
        validatedJson: {
          safetyConstraints: [
            { id: 'safety-food_allergy', kind: 'food_allergy', scope: 'place' },
            { id: 'safety-wheelchair', kind: 'wheelchair', scope: 'route' },
            { id: 'safety-stairs_avoidance', kind: 'stairs_avoidance', scope: 'route' },
          ],
        },
      },
      recommendationResult: { finalWeights: {} },
      stops: [
        {
          id: 'stop-id',
          order: 1,
          placeId: place.id,
          place,
          arrivalAt: new Date('2026-09-05T04:00:00.000Z'),
          leaveAt: new Date('2026-09-05T05:00:00.000Z'),
          estimatedStayMinutes: 60,
          estimatedCost: null,
          reason: '추천 이유',
          scoreBreakdown: { total: 0.8 },
          accessibilityContext: {
            status: 'checked',
            method: 'seoul-gis-straight-corridor-v1',
            risk: 'none-detected',
            derivedGradePercent: null,
            explicitMaxSlopePercent: null,
            stairFeatureCount: 0,
            steepFeatureCount: 0,
            sourceRefs: ['https://data.seoul.go.kr/accessibility'],
            disclaimer: '직선 회랑 검사',
          },
        },
      ],
    } as unknown as Trip;

    const dto = toTripDto(trip);
    expect(dto.safetyConstraints?.requested).toEqual([
      { id: 'safety-food_allergy', kind: 'food_allergy', scope: 'place' },
      { id: 'safety-wheelchair', kind: 'wheelchair', scope: 'route' },
      { id: 'safety-stairs_avoidance', kind: 'stairs_avoidance', scope: 'route' },
    ]);
    expect(dto.safetyConstraints?.assessments[0]).toMatchObject({
      kind: 'food_allergy',
      status: 'unverified',
      result: 'unknown',
    });
    expect(dto.safetyConstraints?.requiresUserConfirmation).toBe(true);
    expect(dto.stops[0]?.accessibilitySafety).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'wheelchair',
          scope: 'route',
          status: 'unverified',
          result: 'unknown',
          sourceRefs: [
            {
              title: '서울시 공개 GIS 보행 위험 탐지 데이터',
              url: 'https://data.seoul.go.kr/accessibility',
              fetchedAt: null,
            },
          ],
        }),
      ]),
    );
  });
});
