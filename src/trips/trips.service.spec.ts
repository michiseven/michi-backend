import { UnprocessableEntityException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type {
  ExternalDataSnapshot,
  Place,
  RecommendationResult,
  RecommendationScore,
  Trip,
  TripPreference,
  TripStop,
} from '../database/entities';
import type { PreferencesService } from '../preferences/preferences.service';
import type { CrowdProvider } from '../providers/crowd/crowd-provider';
import type { PlaceNormalizer } from '../providers/place/place-normalizer';
import type { PlaceProvider } from '../providers/place/place-provider';
import type {
  CandidateRanker,
  OptimizeRouteInput,
  RankCandidatesInput,
} from '../recommendation/ports';
import type { PlaceSearchQueryGenerator } from './place-search-query-generator';
import {
  isAreaConstraint,
  placeAlternatives,
  routeLegOverrides,
  TripsService,
} from './trips.service';
import { DistanceBasedRoutingProvider } from '../routing/distance-based-routing.provider';
import { DeterministicItineraryExplanationProvider } from '../ai/deterministic-itinerary-explanation.provider';
import type { ItineraryExplanationProvider } from '../ai/itinerary-explanation.types';

const accessibility = {
  evaluateLeg: jest.fn().mockResolvedValue({
    status: 'unavailable',
    method: 'unavailable',
    risk: 'unknown',
    derivedGradePercent: null,
    explicitMaxSlopePercent: null,
    stairFeatureCount: 0,
    steepFeatureCount: 0,
    sourceRefs: [],
    disclaimer: 'test fixture',
  }),
};

describe('isAreaConstraint', () => {
  it.each([
    ['공덕', '공덕'],
    ['공덕동', '공덕'],
    [' 성수 일대 ', '성수'],
  ])('%s는 %s 지역 제약으로 처리한다', (name, area) => {
    expect(isAreaConstraint(name, area)).toBe(true);
  });

  it('실제 장소명은 지역 제약으로 처리하지 않는다', () => {
    expect(isAreaConstraint('리움미술관', '공덕')).toBe(false);
  });
});

describe('placeAlternatives', () => {
  it('adds verified Korean and English aliases for a Japanese Leeum name', () => {
    expect(placeAlternatives('リウム美術館')).toEqual([
      'リウム美術館',
      '리움미술관',
      'Leeum Museum',
    ]);
  });
});

describe('routeLegOverrides', () => {
  it('uses measured and mixed provider evidence but not estimated fallback values', () => {
    const base = {
      distanceKm: 1,
      durationMinutes: 10,
      method: 'seoul-subway-path-v1' as const,
      transportMode: 'subway' as const,
      disclaimer: 'test',
    };
    const result = routeLegOverrides(
      [{ placeId: 'a' }, { placeId: 'b' }, { placeId: 'c' }, { placeId: 'd' }],
      [
        null,
        { ...base, evidence: 'mixed' },
        { ...base, evidence: 'measured' },
        { ...base, evidence: 'estimated' },
      ],
    );

    expect(Object.keys(result)).toEqual(['a->b', 'b->c']);
  });
});

function repository<T extends object>(overrides: object = {}): Repository<T> {
  return overrides as Repository<T>;
}

function tripFixture(): Trip {
  const places = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      source: 'mock',
      sourcePlaceId: 'a',
      name: 'A',
      category: 'cafe',
      address: '서울 성동구',
      roadAddress: null,
      location: { type: 'Point', coordinates: [127.04, 37.54] },
      district: '성동구',
      rawCategory: null,
      rawPayload: {},
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      source: 'mock',
      sourcePlaceId: 'b',
      name: 'B',
      category: 'park',
      address: '서울 성동구',
      roadAddress: null,
      location: { type: 'Point', coordinates: [127.05, 37.55] },
      district: '성동구',
      rawCategory: null,
      rawPayload: {},
    },
  ] as Place[];
  const breakdown = {
    total: 0.8,
    preference: 1,
    crowd: 0.5,
    distance: 0.5,
    time: 1,
    budget: 0.5,
    diversity: 0.5,
    area: 1,
  };
  return {
    id: '33333333-3333-4333-8333-333333333333',
    status: 'ready',
    editToken: 'fixture-edit-token',
    travelDate: '2026-08-18',
    startTime: '13:00:00',
    endTime: '21:00:00',
    budgetKrw: 80_000,
    totalEstimatedCost: null,
    providerMode: 'mock',
    preference: { parserMode: 'mock', validatedJson: {} } as TripPreference,
    recommendationResult: { finalWeights: {} } as RecommendationResult,
    stops: places.map(
      (place, index) =>
        ({
          id: `${index + 4}4444444-4444-4444-8444-444444444444`,
          tripId: '33333333-3333-4333-8333-333333333333',
          placeId: place.id,
          place,
          order: index + 1,
          arrivalAt: new Date(`2026-08-18T0${4 + index}:00:00.000Z`),
          leaveAt: new Date(`2026-08-18T0${5 + index}:00:00.000Z`),
          estimatedStayMinutes: 60,
          estimatedCost: null,
          reason: 'reason',
          crowdContext: null,
          scoreBreakdown: breakdown,
        }) as TripStop,
    ),
  } as Trip;
}

describe('TripsService atomic stop editing', () => {
  it('does not mutate persistence when the edited route is infeasible', async () => {
    const trip = tripFixture();
    const transaction = jest.fn();
    const service = new TripsService(
      repository<Trip>({ findOne: jest.fn().mockResolvedValue(trip) }),
      repository<TripPreference>(),
      repository<Place>(),
      repository<TripStop>({ manager: { transaction } }),
      repository<RecommendationResult>(),
      repository<RecommendationScore>(),
      repository<ExternalDataSnapshot>(),
      {} as PreferencesService,
      {} as PlaceSearchQueryGenerator,
      {} as PlaceNormalizer,
      {} as never,
      {} as never,
      {
        nearestCrowdArea: jest.fn().mockResolvedValue(null),
        filterPlaces: jest.fn(),
      } as never,
      { mode: 'mock' } as never,
      { mode: 'mock' } as PlaceProvider,
      { mode: 'mock' } as CrowdProvider,
      {} as CandidateRanker,
      { optimize: jest.fn().mockReturnValue([]) },
      { forPlaces: jest.fn() } as never,
      new DistanceBasedRoutingProvider(),
      accessibility as never,
      new DeterministicItineraryExplanationProvider(),
    );

    await expect(
      service.patchStops(
        trip.id,
        { action: 'remove', stopId: trip.stops[0]!.id },
        'fixture-edit-token',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('generates multi-day trips and loads successfully without 500 errors', async () => {
    const trip = tripFixture();
    let persistedStops: TripStop[] = [];
    const saveTrip = jest
      .fn()
      .mockImplementation((t: Partial<Trip>) => Promise.resolve({ ...trip, ...t }));
    const saveStops = jest.fn().mockImplementation((stops: TripStop[]) => {
      persistedStops = stops;
      return Promise.resolve(stops);
    });
    const saveScores = jest.fn().mockImplementation((scores: RecommendationScore[]) => {
      expect(scores).toHaveLength(2);
      return Promise.resolve(scores);
    });
    const findOneTrip = jest.fn().mockResolvedValue(trip);

    const service = new TripsService(
      repository<Trip>({
        save: saveTrip,
        create: jest
          .fn()
          .mockImplementation((dto: Partial<Trip>) => ({ id: trip.id, ...dto }) as Trip),
        findOne: findOneTrip,
      }),
      repository<TripPreference>({
        save: jest.fn().mockResolvedValue({}),
        create: jest
          .fn()
          .mockImplementation((dto: Partial<TripPreference>) => dto as TripPreference),
      }),
      repository<Place>({
        save: jest
          .fn()
          .mockImplementation((p: Partial<Place>) =>
            Promise.resolve({ id: `place-${p.sourcePlaceId}`, ...p } as Place),
          ),
        create: jest.fn().mockImplementation((p: Partial<Place>) => p as Place),
        findOneBy: jest.fn().mockResolvedValue(null),
      }),
      repository<TripStop>({
        save: saveStops,
        create: jest
          .fn()
          .mockImplementation((s: Partial<TripStop>) => ({ id: 'stop-id', ...s }) as TripStop),
      }),
      repository<RecommendationResult>({
        save: jest.fn().mockResolvedValue({ id: 'res-id' }),
        create: jest
          .fn()
          .mockImplementation((r: Partial<RecommendationResult>) => r as RecommendationResult),
      }),
      repository<RecommendationScore>({
        save: saveScores,
        create: jest
          .fn()
          .mockImplementation((s: Partial<RecommendationScore>) => s as RecommendationScore),
      }),
      repository<ExternalDataSnapshot>({
        save: jest.fn().mockResolvedValue({}),
        create: jest
          .fn()
          .mockImplementation((s: Partial<ExternalDataSnapshot>) => s as ExternalDataSnapshot),
      }),
      {
        parse: jest.fn().mockResolvedValue({
          preference: {
            area: '한남',
            startTime: '13:30',
            endTime: '21:00',
            budget: 240_000,
            interests: ['cafe', 'culture'],
            preferences: [],
            avoid: [],
            days: [
              {
                dayNumber: 1,
                date: '2026-08-29',
                area: '한남',
                startTime: '13:30',
                endTime: '21:00',
                dailyBudgetKrw: 80_000,
                interests: ['cafe'],
                preferences: [],
                avoid: [],
              },
              {
                dayNumber: 2,
                date: '2026-08-30',
                area: '성수',
                startTime: '10:30',
                endTime: '21:00',
                dailyBudgetKrw: 80_000,
                interests: ['shopping'],
                preferences: [],
                avoid: [],
              },
            ],
          },
          parserMode: 'mock',
          warnings: [],
        }),
      } as unknown as PreferencesService,
      { generate: jest.fn().mockReturnValue(['카페']) },
      {
        normalize: jest.fn().mockImplementation((p: { name: string; sourcePlaceId: string }) => ({
          source: 'naver',
          sourcePlaceId: p.sourcePlaceId,
          name: p.name,
          category: 'cafe',
          address: '서울시',
          roadAddress: null,
          location: { type: 'Point', coordinates: [127.0, 37.5] },
          district: '용산구',
          rawCategory: null,
          rawPayload: {},
        })),
      },
      { searchKtoCandidates: jest.fn().mockResolvedValue([]) } as never,
      {
        deduplicate: jest.fn().mockImplementation((places: Place[]) => ({
          places: places.filter(
            (place, index, all) => all.findIndex((item) => item.id === place.id) === index,
          ),
          removedCount: 0,
        })),
      },
      {
        nearestCrowdArea: jest.fn().mockResolvedValue(null),
        filterPlaces: jest
          .fn()
          .mockImplementation((_area: string, places: Place[]) =>
            Promise.resolve({ applied: true, expanded: false, places }),
          ),
      } as never,
      { mode: 'mock' } as never,
      {
        mode: 'mock',
        search: jest.fn().mockResolvedValue({
          places: [
            {
              provider: 'naver',
              sourcePlaceId: '1',
              name: '카페 A',
              category: 'cafe',
              address: '서울',
              roadAddress: null,
              latitude: 37.5,
              longitude: 127.0,
              rawCategory: '카페',
              rawPayload: {},
            },
            {
              provider: 'naver',
              sourcePlaceId: '2',
              name: '카페 B',
              category: 'cafe',
              address: '서울',
              roadAddress: null,
              latitude: 37.51,
              longitude: 127.01,
              rawCategory: '카페',
              rawPayload: {},
            },
          ],
        }),
      } as unknown as PlaceProvider,
      { mode: 'mock', getAreaCrowd: jest.fn().mockResolvedValue(null) } as unknown as CrowdProvider,
      {
        rank: jest.fn().mockImplementation((input: RankCandidatesInput) => ({
          algorithmVersion: 'deterministic-v2',
          weights: {
            preference: 0.35,
            crowd: 0.2,
            distance: 0.15,
            time: 0.1,
            budget: 0.1,
            diversity: 0.05,
            area: 0.05,
          },
          candidates: input.places.map((place, index) => ({
            place,
            estimatedCost: 10_000,
            estimatedStayMinutes: 60,
            scoreBreakdown: {
              total: 1 - index * 0.1,
              preference: 1,
              crowd: 0.5,
              distance: 0.8,
              time: 1,
              budget: 1,
              diversity: 0.5,
              area: 1,
            },
            reason: '좋은 카페',
          })),
          warnings: [],
        })),
      },
      {
        optimize: jest.fn().mockImplementation((input: OptimizeRouteInput) => {
          const candidate = input.candidates[0];
          if (!candidate) return [];
          return [
            {
              placeId: candidate.place.placeId,
              order: 1,
              arrivalAt: `${input.travelDate}T14:00:00.000Z`,
              leaveAt: `${input.travelDate}T15:00:00.000Z`,
              estimatedStayMinutes: 60,
              estimatedCost: 10_000,
              reason: candidate.reason,
              scoreBreakdown: candidate.scoreBreakdown,
            },
          ];
        }),
      },
      { forPlaces: jest.fn().mockResolvedValue(new Map()) } as never,
      new DistanceBasedRoutingProvider(),
      accessibility as never,
      new DeterministicItineraryExplanationProvider(),
    );

    const response = await service.generate({
      text: '8월 29일부터 30일까지 한남이랑 성수 갈래',
      startArea: '한남',
      locale: 'ko',
    });

    expect(response).toBeDefined();
    expect(response.trip).toBeDefined();
    expect(response.providerModes).toBeDefined();
    expect(saveStops).toHaveBeenCalled();
    expect(persistedStops.map((stop) => stop.placeId)).toEqual(['place-1', 'place-2']);
    expect(new Set(persistedStops.map((stop) => stop.placeId)).size).toBe(persistedStops.length);
    expect(saveScores).toHaveBeenCalledTimes(1);
    expect(findOneTrip).toHaveBeenCalled();
  });

  it('throws MANDATORY_PLACE_NOT_FOUND when mandatory place cannot be found with valid name match', async () => {
    const preferencesService = {
      parse: jest.fn().mockResolvedValue({
        preference: {
          tripTitle: '서울 여행',
          area: '용산',
          travelDate: '2026-08-29',
          startDate: '2026-08-29',
          endDate: '2026-08-29',
          totalDays: 1,
          startTime: '13:00',
          endTime: '20:30',
          budget: null,
          fixedAppointments: [
            { name: '리움미술관', targetTime: '15:00', durationMinutes: 90, isMandatory: true },
          ],
          interests: ['culture'],
          preferences: [],
          avoid: [],
          days: [
            {
              dayNumber: 1,
              date: '2026-08-29',
              area: '용산',
              startTime: '13:00',
              endTime: '20:30',
              fixedAppointments: [
                { name: '리움미술관', targetTime: '15:00', durationMinutes: 90, isMandatory: true },
              ],
              interests: ['culture'],
              preferences: [],
              avoid: [],
            },
          ],
        },
        parserMode: 'mock',
        warnings: [],
      }),
    } as unknown as PreferencesService;

    const placeProvider = {
      search: jest.fn().mockResolvedValue({
        places: [
          // Returns completely unrelated place
          {
            source: 'naver',
            sourcePlaceId: 'unrelated',
            name: '웨스틴 조선 서울',
            category: 'hotel',
            address: '서울 중구',
            roadAddress: null,
            latitude: 37.56,
            longitude: 126.98,
            rawCategory: '호텔',
            rawPayload: {},
          },
        ],
        providerMode: 'live',
      }),
    } as unknown as PlaceProvider;

    const service = new TripsService(
      repository<Trip>({ create: (d: object) => ({ ...d, id: 'trip-1' }), save: (d: object) => d }),
      repository<TripPreference>({ create: (d: object) => d, save: (d: object) => d }),
      repository<Place>({ findOneBy: jest.fn(), save: jest.fn(), create: (d: object) => d }),
      repository<TripStop>({ create: (d: object) => d, save: jest.fn() }),
      repository<RecommendationResult>({ create: (d: object) => d, save: jest.fn() }),
      repository<RecommendationScore>({ create: (d: object) => d, save: jest.fn() }),
      repository<ExternalDataSnapshot>({ create: (d: object) => d, save: jest.fn() }),
      preferencesService,
      { generate: (): string[] => ['리움미술관'] },
      { normalize: (p: object) => p } as unknown as PlaceNormalizer,
      { searchKtoCandidates: jest.fn().mockResolvedValue([]) } as never,
      { deduplicate: (p: { places: object[] }) => ({ places: p.places, reasons: [] }) } as never,
      {
        nearestCrowdArea: jest.fn().mockResolvedValue(null),
        filterPlaces: jest
          .fn()
          .mockImplementation((_area: string, places: Place[]) =>
            Promise.resolve({ applied: true, expanded: false, places }),
          ),
      } as never,
      { mode: 'mock' } as never,
      placeProvider,
      { mode: 'mock', getAreaCrowd: jest.fn().mockResolvedValue(null) } as unknown as CrowdProvider,
      { rank: jest.fn().mockReturnValue({ candidates: [], weights: {}, algorithmVersion: 'v1' }) },
      { optimize: jest.fn().mockReturnValue([]) },
      { forPlaces: jest.fn().mockResolvedValue(new Map()) } as never,
      new DistanceBasedRoutingProvider(),
      accessibility as never,
      new DeterministicItineraryExplanationProvider(),
    );

    await expect(
      service.generate({
        text: '리움미술관 꼭 갈래',
        startArea: '용산',
        locale: 'ko',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'MANDATORY_PLACE_NOT_FOUND',
      },
    });
  });

  it('includes fallback warning when explanationProvider returns fallback mode', async () => {
    const generateSpy = jest.fn().mockResolvedValue({
      tripSummary: '규칙 기반 여행 요약입니다.',
      locale: 'ko',
      stops: [
        {
          order: 1,
          placeId: 'p-1',
          shortDescription: '카페 설명',
          previousStopFit: null,
          nextStopFit: null,
          overallTripFit: '적합',
        },
      ],
      mode: 'fallback',
      model: null,
    });
    const mockExplanationProvider: ItineraryExplanationProvider = {
      generate: generateSpy,
    };

    const preferencesService = {
      parse: jest.fn().mockResolvedValue({
        preference: {
          area: '성수',
          travelDate: '2026-08-29',
          startDate: '2026-08-29',
          endDate: '2026-08-29',
          totalDays: 1,
          startTime: '10:00',
          endTime: '18:00',
          interests: ['cafe'],
          preferences: [],
          avoid: [],
          days: [
            {
              dayNumber: 1,
              date: '2026-08-29',
              area: '성수',
              startTime: '10:00',
              endTime: '18:00',
              interests: ['cafe'],
              preferences: [],
              avoid: [],
            },
          ],
        },
        parserMode: 'mock',
        warnings: [],
      }),
    } as unknown as PreferencesService;

    const findOneTrip = jest.fn().mockResolvedValue({
      id: 'trip-1',
      status: 'ready',
      travelDate: '2026-08-29',
      startTime: '10:00:00',
      endTime: '18:00:00',
      budgetKrw: null,
      totalEstimatedCost: 5000,
      providerMode: 'mock',
      preference: {
        rawInputText: '성수 카페 갈래',
        area: '성수',
        startDate: '2026-08-29',
        endDate: '2026-08-29',
        totalDays: 1,
        startTime: '10:00',
        endTime: '18:00',
        budget: null,
        interests: ['cafe'],
        preferences: [],
        avoid: [],
        days: [
          {
            dayNumber: 1,
            date: '2026-08-29',
            area: '성수',
            startTime: '10:00',
            endTime: '18:00',
            interests: ['cafe'],
            preferences: [],
            avoid: [],
          },
        ],
      },
      stops: [
        {
          id: 'stop-1',
          order: 1,
          dayNumber: 1,
          placeId: 'p-1',
          placeName: '성수 카페',
          category: 'cafe',
          address: '서울시',
          latitude: 37.5,
          longitude: 127.0,
          place: {
            id: 'place-id',
            source: 'naver',
            sourcePlaceId: '1',
            name: '성수 카페',
            category: 'cafe',
            address: '서울시',
            roadAddress: null,
            location: { type: 'Point', coordinates: [127.0, 37.5] },
            district: '성동구',
            rawCategory: '카페',
            rawPayload: {},
          },
          arrivalAt: new Date('2026-08-29T10:00:00.000Z'),
          leaveAt: new Date('2026-08-29T11:00:00.000Z'),
          estimatedStayMinutes: 60,
          reason: '좋은 카페',
          crowdContext: null,
          scoreBreakdown: {
            total: 1.0,
            preference: 1.0,
            distance: 0.5,
            crowd: 0.5,
            time: 1.0,
            budget: 0.5,
            diversity: 0.5,
            area: 1.0,
          },
          explanation: {
            shortDescription: '카페 설명',
            previousStopFit: null,
            nextStopFit: null,
            overallTripFit: '적합',
          },
        },
      ],
      recommendationResult: {
        id: 'res-1',
        explanation: {
          tripSummary: '규칙 기반 여행 요약입니다.',
          locale: 'ko',
          mode: 'fallback',
          model: null,
        },
      } as RecommendationResult,
    });

    const service = new TripsService(
      repository<Trip>({
        create: (d: object) => ({ ...d, id: 'trip-1' }),
        save: (d: object) => d,
        findOne: findOneTrip,
      }),
      repository<TripPreference>({ create: (d: object) => d, save: (d: object) => d }),
      repository<Place>({
        findOneBy: jest.fn().mockResolvedValue(null),
        save: jest
          .fn()
          .mockImplementation((p: Partial<Place>) =>
            Promise.resolve({ id: 'place-id', ...p } as Place),
          ),
        create: (d: object) => d,
      }),
      repository<TripStop>({ create: (d: object) => d, save: jest.fn().mockResolvedValue([]) }),
      repository<RecommendationResult>({
        create: (d: object) => d,
        save: jest.fn().mockResolvedValue({ id: 'res-id' }),
      }),
      repository<RecommendationScore>({
        create: (d: object) => d,
        save: jest.fn().mockResolvedValue([]),
      }),
      repository<ExternalDataSnapshot>({
        create: (d: object) => d,
        save: jest.fn().mockResolvedValue({}),
      }),
      preferencesService,
      { generate: (): string[] => ['성수 카페'] },
      {
        normalize: () => ({
          placeId: 'p-1',
          source: 'naver',
          name: '성수 카페',
          category: 'cafe',
          address: '서울',
          roadAddress: null,
          location: { type: 'Point', coordinates: [127.0, 37.5] },
          district: '성동구',
          rawCategory: '카페',
          rawPayload: {
            sourceRecord: {
              description: '<b>성수</b>의 &quot;인기&quot; 카페입니다.',
            },
          },
        }),
      } as unknown as PlaceNormalizer,
      { searchKtoCandidates: jest.fn().mockResolvedValue([]) } as never,
      {
        deduplicate: jest
          .fn()
          .mockImplementation((places: Place[]) => ({ places, removedCount: 0 })),
      },
      {
        nearestCrowdArea: jest.fn().mockResolvedValue(null),
        filterPlaces: jest
          .fn()
          .mockImplementation((_area: string, places: Place[]) =>
            Promise.resolve({ applied: true, expanded: false, places }),
          ),
      } as never,
      { mode: 'mock' } as never,
      {
        mode: 'mock',
        search: jest.fn().mockResolvedValue({
          places: [
            {
              provider: 'naver',
              sourcePlaceId: '1',
              name: '성수 카페',
              category: 'cafe',
              address: '서울',
              roadAddress: null,
              latitude: 37.5,
              longitude: 127.0,
              rawCategory: '카페',
              rawPayload: {
                sourceRecord: {
                  description: '<b>성수</b>의 &quot;인기&quot; 카페입니다.',
                },
              },
            },
          ],
        }),
      } as unknown as PlaceProvider,
      { mode: 'mock', getAreaCrowd: jest.fn().mockResolvedValue(null) } as unknown as CrowdProvider,
      {
        rank: jest.fn().mockReturnValue({
          algorithmVersion: 'deterministic-v2',
          weights: { preference: 0.5 },
          candidates: [
            {
              place: {
                placeId: 'p-1',
                name: '성수 카페',
                location: { type: 'Point', coordinates: [127.0, 37.5] },
                rawPayload: {
                  sourceRecord: {
                    description: '<b>성수</b>의 &quot;인기&quot; 카페입니다.',
                  },
                },
              },
              scoreBreakdown: { total: 1.0 },
              reason: '좋은 카페',
            },
          ],
          warnings: [],
        }),
      },
      {
        optimize: jest.fn().mockReturnValue([
          {
            placeId: 'p-1',
            order: 1,
            arrivalAt: '2026-08-29T10:00:00.000Z',
            leaveAt: '2026-08-29T11:00:00.000Z',
            estimatedStayMinutes: 60,
            estimatedCost: 5000,
            reason: '좋은 카페',
            scoreBreakdown: { total: 1.0 },
          },
        ]),
      },
      { forPlaces: jest.fn().mockResolvedValue(new Map()) } as never,
      new DistanceBasedRoutingProvider(),
      accessibility as never,
      mockExplanationProvider,
    );

    const res = await service.generate({
      text: '성수 카페 갈래',
      startArea: '성수',
      locale: 'ko',
    });

    expect(res.providerModes.explanation).toBe('fallback');
    expect(res.warnings.some((w) => w.includes('AI 상세 일정 설명'))).toBe(true);
    // Verify that the prompt generator received sanitized description without HTML tags
    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        stops: [
          expect.objectContaining({
            verifiedDescription: '성수의 "인기" 카페입니다.',
          }),
        ],
      }),
    );
  });

  it('supports action replace in patchStops to swap a place', async () => {
    const existingTrip = {
      id: 'trip-1',
      editToken: 'token-replace-1',
      providerMode: 'live',
      travelDate: '2026-08-29',
      startTime: '10:00:00',
      endTime: '18:00:00',
      budgetKrw: 50000,
      preference: {
        validatedJson: {},
      },
      stops: [
        {
          id: 'stop-1',
          order: 1,
          placeId: 'p-1',
          place: {
            id: 'p-1',
            name: '기존 장소',
            category: 'cafe',
            source: 'kto',
            sourcePlaceId: 'k-1',
            location: { type: 'Point', coordinates: [127.05, 37.54] },
          },
          estimatedCost: 5000,
          estimatedStayMinutes: 60,
          reason: '기존 카페',
          scoreBreakdown: { total: 1.0 },
        },
      ],
    };

    const newPlace = {
      id: 'p-2',
      name: '새로운 대안 카페',
      category: 'cafe',
      source: 'kto',
      sourcePlaceId: 'k-2',
      location: { type: 'Point', coordinates: [127.051, 37.541] },
      estimatedCostKrw: 7000,
    };

    const tripsRepo = {
      findOne: jest.fn().mockResolvedValue(existingTrip),
      update: jest.fn().mockResolvedValue({}),
    };
    const placesRepo = {
      findOneBy: jest.fn().mockImplementation(({ id }) => (id === 'p-2' ? newPlace : null)),
    };
    const tripStopsRepo = {
      manager: {
        transaction: jest.fn().mockImplementation((cb: (m: unknown) => Promise<unknown>) => {
          const managerMock = {
            delete: jest.fn().mockResolvedValue({}),
            createQueryBuilder: jest.fn().mockReturnValue({
              update: jest.fn().mockReturnThis(),
              set: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              execute: jest.fn().mockResolvedValue({}),
            }),
            update: jest.fn().mockResolvedValue({}),
          };
          return cb(managerMock);
        }),
      },
    };

    const optimizer = {
      optimize: jest.fn().mockReturnValue([
        {
          placeId: 'p-2',
          order: 1,
          arrivalAt: '2026-08-29T10:00:00.000Z',
          leaveAt: '2026-08-29T11:00:00.000Z',
          estimatedStayMinutes: 60,
          estimatedCost: null,
          reason: '대체 장소 교체: 새로운 대안 카페',
          scoreBreakdown: { total: 1.0 },
        },
      ]),
    };

    const service = new TripsService(
      tripsRepo as never,
      {} as never,
      placesRepo as never,
      tripStopsRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        nearestCrowdArea: jest.fn().mockResolvedValue(null),
        filterPlaces: jest.fn(),
      } as never,
      { mode: 'live', name: 'kto' } as never,
      { mode: 'live', name: 'kakao-local' } as never,
      { mode: 'mock' } as never,
      {} as never,
      optimizer,
      { forPlaces: jest.fn() } as never,
      new DistanceBasedRoutingProvider(),
      {
        evaluatePlanLegs: jest.fn().mockResolvedValue({
          routes: [],
          accessibility: [],
          warnings: [],
        }),
      } as never,
      new DeterministicItineraryExplanationProvider(),
    );

    const result = await service.patchStops(
      'trip-1',
      {
        action: 'replace',
        stopId: 'stop-1',
        newPlaceId: 'p-2',
      },
      'token-replace-1',
    );

    expect(result).toBeDefined();
    expect(optimizer.optimize).toHaveBeenCalled();
  });

  it('throws ForbiddenException when editToken is missing on a protected trip', async () => {
    const trip = {
      id: 'trip-protected',
      status: 'success',
      editToken: 'secret-token-123',
      providerMode: 'mock',
      travelDate: '2026-08-30',
      startTime: '09:00',
      endTime: '18:00',
      budgetKrw: 100000,
      totalEstimatedCost: null,
      preference: { parserMode: 'mock', validatedJson: {} },
      recommendationResult: null,
      stops: [
        {
          id: 'stop-1',
          placeId: 'p-1',
          placeName: 'Stop 1',
          order: 1,
          place: {
            category: 'cafe',
            name: 'Stop 1',
            location: { type: 'Point', coordinates: [126.97, 37.56] },
          },
        },
      ],
    };

    const tripsRepo = {
      findOne: jest.fn().mockResolvedValue(trip),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };

    const service = new TripsService(
      tripsRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        nearestCrowdArea: jest.fn().mockResolvedValue(null),
        filterPlaces: jest.fn(),
      } as never,
      { mode: 'mock', name: 'kto' } as never,
      { mode: 'mock', name: 'mock' } as never,
      { mode: 'mock' } as never,
      {} as never,
      {} as never,
      { forPlaces: jest.fn() } as never,
      new DistanceBasedRoutingProvider(),
      {
        evaluatePlanLegs: jest.fn().mockResolvedValue({
          routes: [],
          accessibility: [],
          warnings: [],
        }),
      } as never,
      new DeterministicItineraryExplanationProvider(),
    );

    // 1. Missing editToken -> 403 Forbidden
    await expect(
      service.patchStops('trip-protected', {
        action: 'remove',
        stopId: 'stop-1',
      }),
    ).rejects.toThrow('You do not have permission to modify this trip.');

    // 2. Wrong editToken -> 403 Forbidden
    await expect(
      service.patchStops(
        'trip-protected',
        {
          action: 'remove',
          stopId: 'stop-1',
        },
        'wrong-token',
      ),
    ).rejects.toThrow('You do not have permission to modify this trip.');

    // 3. Public get response does NOT leak editToken in trip DTO
    const publicResponse = await service.get('trip-protected');
    expect((publicResponse.trip as unknown as { editToken?: string }).editToken).toBeUndefined();
    expect(publicResponse.trip.isEditable).toBe(false);
    expect(publicResponse.editToken).toBeUndefined();

    // 4. Authorized get response sets isEditable=true but does NOT leak raw token in trip DTO
    const authedResponse = await service.get('trip-protected', 'secret-token-123');
    expect((authedResponse.trip as unknown as { editToken?: string }).editToken).toBeUndefined();
    expect(authedResponse.trip.isEditable).toBe(true);
  });

  it('strictly locks legacy trips with editToken=null as read-only (isEditable=false and patchStops rejects with 403)', async () => {
    const legacyTrip = {
      id: 'trip-legacy-91',
      status: 'success',
      editToken: null,
      providerMode: 'mock',
      travelDate: '2026-08-30',
      startTime: '09:00',
      endTime: '18:00',
      budgetKrw: 100000,
      totalEstimatedCost: null,
      preference: { parserMode: 'mock', validatedJson: {} },
      recommendationResult: null,
      stops: [
        {
          id: 'stop-1',
          placeId: 'p-1',
          placeName: 'Stop 1',
          order: 1,
          place: {
            category: 'cafe',
            name: 'Stop 1',
            location: { type: 'Point', coordinates: [126.97, 37.56] },
          },
        },
      ],
    };

    const tripsRepo = {
      findOne: jest.fn().mockResolvedValue(legacyTrip),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };

    const service = new TripsService(
      tripsRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        nearestCrowdArea: jest.fn().mockResolvedValue(null),
        filterPlaces: jest.fn(),
      } as never,
      { mode: 'mock', name: 'kto' } as never,
      { mode: 'mock', name: 'mock' } as never,
      { mode: 'mock' } as never,
      {} as never,
      {} as never,
      { forPlaces: jest.fn() } as never,
      new DistanceBasedRoutingProvider(),
      {
        evaluatePlanLegs: jest.fn().mockResolvedValue({
          routes: [],
          accessibility: [],
          warnings: [],
        }),
      } as never,
      new DeterministicItineraryExplanationProvider(),
    );

    // 1. Get response sets isEditable=false
    const getRes = await service.get('trip-legacy-91');
    expect(getRes.trip.isEditable).toBe(false);

    // 2. patchStops rejects with 403 Forbidden even if no token is passed
    await expect(
      service.patchStops('trip-legacy-91', {
        action: 'remove',
        stopId: 'stop-1',
      }),
    ).rejects.toThrow('You do not have permission to modify this trip.');

    // 3. patchStops rejects with 403 Forbidden even if arbitrary token is passed
    await expect(
      service.patchStops(
        'trip-legacy-91',
        {
          action: 'remove',
          stopId: 'stop-1',
        },
        'any-token',
      ),
    ).rejects.toThrow('You do not have permission to modify this trip.');
  });
});
