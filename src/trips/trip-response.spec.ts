import type {
  Place,
  RecommendationResult,
  Trip,
  TripPreference,
  TripStop,
} from '../database/entities';
import { toTripDto } from './trip-response';

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
});
