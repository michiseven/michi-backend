import type { ParsedTripPreference } from '../preferences/preference.types';
import type { CrowdObservation } from '../providers/crowd/crowd-provider';
import {
  DeterministicCandidateRanker,
  dynamicScoreWeights,
} from './deterministic-candidate-ranker';
import type {
  CandidatePlace,
  RankCandidatesInput,
  ScoreWeights,
  TourismScoreWeights,
} from './ports';

function place(
  placeId: string,
  category: string,
  longitude: number | null,
  latitude: number | null,
  extras: Partial<CandidatePlace> = {},
): CandidatePlace {
  return {
    placeId,
    source: 'test',
    sourcePlaceId: placeId,
    name: placeId,
    category,
    address: '서울특별시 성동구 성수동',
    roadAddress: null,
    location:
      longitude === null || latitude === null
        ? null
        : { type: 'Point', coordinates: [longitude, latitude] },
    district: '성동구',
    rawCategory: category,
    rawPayload: {},
    ...extras,
  };
}

const preference: ParsedTripPreference = {
  area: '성수',
  startTime: '13:00',
  endTime: '21:00',
  budget: 80_000,
  companions: 'solo',
  pace: 'relaxed',
  interests: ['cafe', 'shopping', 'meat'],
  preferences: ['quiet'],
  avoid: ['crowded'],
  days: [],
};

const crowd: CrowdObservation = {
  provider: 'test',
  providerMode: 'live',
  scope: 'area',
  areaName: '성수역 일대',
  areaCode: null,
  congestionLevel: '보통',
  congestionMessage: null,
  observedAt: '2026-08-18T13:00:00+09:00',
  disclaimer: '특정 장소 내부 혼잡도가 아닙니다.',
  sourceUrl: 'https://data.seoul.go.kr/',
  rawPayload: {},
};

describe('DeterministicCandidateRanker', () => {
  const ranker = new DeterministicCandidateRanker();
  const places = [
    place('cafe-near', 'cafe', 127.044, 37.546, {
      estimatedCostKrw: 12_000,
      openingHours: [{ opensAt: '10:00', closesAt: '22:00' }],
    }),
    place('cafe-near-2', 'cafe', 127.045, 37.5465),
    place('shop-far', 'shopping', 127.15, 37.62),
  ];

  it('calculates coordinate distance, category diversity, and a complete score breakdown', () => {
    const result = ranker.rank({ preference, places, crowd });
    const cafe = result.candidates.find((candidate) => candidate.place.placeId === 'cafe-near');
    const shop = result.candidates.find((candidate) => candidate.place.placeId === 'shop-far');
    expect(cafe).toBeDefined();
    expect(shop).toBeDefined();
    expect(cafe!.scoreBreakdown.distance).toBeGreaterThan(shop!.scoreBreakdown.distance);
    expect(shop!.scoreBreakdown.diversity).toBeGreaterThan(cafe!.scoreBreakdown.diversity);
    expect(cafe!.scoreBreakdown.time).toBe(1);
    expect(Object.keys(cafe!.scoreBreakdown).sort()).toEqual(
      [
        'area',
        'budget',
        'crowd',
        'distance',
        'diversity',
        'preference',
        'time',
        'total',
        'localImpact',
      ].sort(),
    );
    const componentTotal = (
      Object.keys(result.weights) as Array<keyof TourismScoreWeights>
    ).reduce<number>((sum, component) => {
      const compVal = cafe!.scoreBreakdown[component];
      const weightVal = result.weights[component];
      if (typeof compVal === 'number' && typeof weightVal === 'number') {
        return sum + compVal * weightVal;
      }
      return sum;
    }, 0);
    expect(cafe!.scoreBreakdown.total).toBeCloseTo(componentTotal, 5);
  });

  it('raises crowd weight by normalized avoidance intensity and normalizes all weights', () => {
    const baseInput: RankCandidatesInput = {
      preference: { ...preference, area: null, preferences: [], avoid: [] },
      places,
      crowd,
    };
    const normal = dynamicScoreWeights({
      ...baseInput,
      preference: { ...baseInput.preference, avoid: ['混雑'] },
    });
    const strong = dynamicScoreWeights({
      ...baseInput,
      preference: { ...baseInput.preference, avoid: ['very-crowded'] },
    });
    expect(normal.crowd).toBeGreaterThan(dynamicScoreWeights(baseInput).crowd);
    expect(strong.crowd).toBeGreaterThan(normal.crowd);
    const weightTotal = (Object.keys(strong) as Array<keyof ScoreWeights>).reduce(
      (sum, key) => sum + strong[key],
      0,
    );
    expect(weightTotal).toBeCloseTo(1, 7);
  });

  it('uses explicit neutral scores and warnings for missing facts', () => {
    const unknown = ranker.rank({
      preference,
      places: [place('unknown', 'cafe', null, null)],
      crowd: null,
    });
    expect(unknown.candidates[0]?.scoreBreakdown).toMatchObject({
      crowd: 0.5,
      distance: 0.5,
      time: 0.5,
      budget: 0.5,
    });
    expect(unknown.warnings.join(' ')).toContain('중립값');
    expect(unknown.warnings.join(' ')).toContain('경로 후보에서 제외');
  });

  it('is stable for identical input and explains area-level crowd scope in Japanese', () => {
    const input = { preference, places, crowd };
    const first = ranker.rank(input);
    const second = ranker.rank(input);
    expect(second).toEqual(first);
    expect(first.candidates[0]?.reason).toContain('店内混雑度ではありません');
    expect(first.candidates[0]?.reason).toContain('最終');
    expect(first.candidates[0]?.reason).toContain('好み');
  });

  it('uses imported tourism dispersion only when source-backed evidence is available', () => {
    const tourismSource = {
      sourceRef: 'visitor-count',
      sourceName: '한국관광 데이터랩',
      dataset: '지역별 방문자 수',
      sourceUrl: 'https://example.com/official',
      referencePeriod: '2026-07',
      importedAt: '2026-08-17T00:00:00.000Z',
      mode: 'live' as const,
    };
    const result = ranker.rank({
      preference: { ...preference, interests: ['cafe'] },
      crowd: null,
      places: [
        place('concentrated', 'cafe', 127.04, 37.54, {
          tourism: {
            concentration: {
              algorithmVersion: 'test',
              concentration: 0.9,
              dispersion: 0.1,
              features: {},
            },
            tourismFlow: null,
            referencePeriod: '2026-07',
            spatialScope: 'area',
            areaName: '성동구',
            dataMode: 'live',
            sources: [tourismSource],
          },
        }),
        place('dispersed', 'cafe', 127.04, 37.54, {
          tourism: {
            concentration: {
              algorithmVersion: 'test',
              concentration: 0.2,
              dispersion: 0.8,
              features: {},
            },
            tourismFlow: null,
            referencePeriod: '2026-07',
            spatialScope: 'area',
            areaName: '성동구',
            dataMode: 'live',
            sources: [tourismSource],
          },
        }),
      ],
    });

    expect(result.weights.tourismDispersion).toBeGreaterThan(0);
    expect(result.candidates[0]?.place.placeId).toBe('dispersed');
    expect(result.candidates[0]?.scoreBreakdown).toMatchObject({
      tourismDispersion: 0.8,
    });
  });

  it('dynamically renormalizes weights for candidates with missing tourism metrics without penalizing them to 0', () => {
    const tourismSource = {
      sourceRef: 'visitor-count',
      sourceName: '한국관광 데이터랩',
      dataset: '지역별 방문자 수',
      sourceUrl: 'https://example.com/official',
      referencePeriod: '2026-07',
      importedAt: '2026-08-17T00:00:00.000Z',
      mode: 'live' as const,
    };
    const withTourism = place('with-tourism', 'cafe', 127.04, 37.54, {
      tourism: {
        concentration: {
          algorithmVersion: 'test',
          concentration: 0.5,
          dispersion: 0.5,
          features: {},
        },
        tourismFlow: null,
        referencePeriod: '2026-07',
        spatialScope: 'area',
        areaName: '성동구',
        dataMode: 'live',
        sources: [tourismSource],
      },
    });
    const withoutTourism = place('without-tourism', 'cafe', 127.04, 37.54);

    const result = ranker.rank({
      preference: { ...preference, interests: ['cafe'] },
      crowd: null,
      places: [withTourism, withoutTourism],
    });

    const candWithout = result.candidates.find((c) => c.place.placeId === 'without-tourism');
    expect(candWithout?.scoreBreakdown.tourismDispersion).toBeUndefined();
    expect(candWithout?.scoreBreakdown.total).toBeGreaterThan(0.4);
  });

  it('boosts distance weight and includes walking explanation when walking constraints are specified', () => {
    const baseWeights = dynamicScoreWeights({
      preference,
      places,
      crowd,
    });
    const walkingWeights = dynamicScoreWeights({
      preference: { ...preference, avoid: ['long_walk'], maxWalkMinutes: 7 },
      places,
      crowd,
    });
    expect(walkingWeights.distance).toBeGreaterThan(baseWeights.distance);
    expect(walkingWeights.distance).toBeGreaterThan(0.3);

    const resultKo = ranker.rank({
      preference: { ...preference, avoid: ['long_walk'], maxWalkMinutes: 7 },
      places,
      crowd,
      locale: 'ko',
    });
    expect(resultKo.candidates[0]?.reason).toContain('도보 부담 조건을 반영했고');

    const resultJa = ranker.rank({
      preference: { ...preference, avoid: ['long_walk'], maxWalkMinutes: 7 },
      places,
      crowd,
      locale: 'ja',
    });
    expect(resultJa.candidates[0]?.reason).toContain('徒歩負担の条件を反映し');
  });

  it('ranks anchor venue with full total score and dedicated anchor explanation', () => {
    const anchorPlace = place('kspo-dome', 'culture', 127.127, 37.519, {
      isAnchor: true,
      name: 'KSPO DOME',
    });
    const resultKo = ranker.rank({
      preference: {
        ...preference,
        anchorPlace: { name: 'KSPO DOME', targetTime: '18:00', role: 'destination' },
      },
      places: [anchorPlace, ...places],
      crowd,
      locale: 'ko',
    });
    const anchor = resultKo.candidates.find((c) => c.place.placeId === 'kspo-dome');
    expect(anchor).toBeDefined();
    expect(anchor!.scoreBreakdown.total).toBe(1);
    expect(anchor!.reason).toContain('사용자가 직접 지정한 필수 방문 장소');
    expect(anchor!.reason).toContain('추천 점수 경쟁으로 선택된 장소가 아니라');

    const resultJa = ranker.rank({
      preference: {
        ...preference,
        anchorPlace: { name: 'KSPO DOME', targetTime: '18:00', role: 'destination' },
      },
      places: [anchorPlace, ...places],
      crowd,
      locale: 'ja',
    });
    const anchorJa = resultJa.candidates.find((c) => c.place.placeId === 'kspo-dome');
    expect(anchorJa!.reason).toContain('ユーザーが直接指定した必須訪問スポット');
  });

  it('explains fixed appointments as constraints instead of score winners', () => {
    const museum = place('leeum', 'culture', 127.01, 37.54, {
      isAnchor: true,
      fixedAppointment: true,
      targetTime: '15:00',
      name: '리움미술관',
    });
    const result = ranker.rank({ preference, places: [museum], crowd, locale: 'ko' });

    expect(result.candidates[0]?.reason).toContain('15:00에 반드시 방문');
    expect(result.candidates[0]?.reason).toContain('시간 제약을 우선');
  });

  it('assigns high localImpact score to independent local places and penalizes franchises', () => {
    const localCafe = place('local-bakery', 'cafe', 127.04, 37.54, {
      name: '밀도 성수본점',
      address: '서울특별시 성동구 서울숲길 44',
      roadAddress: '서울특별시 성동구 서울숲길 44',
    });
    const franchiseCafe = place('starbucks-ss', 'cafe', 127.04, 37.54, {
      name: '스타벅스 성수역점',
      address: '서울특별시 성동구 아차산로 100',
      roadAddress: '서울특별시 성동구 아차산로 100',
    });

    const result = ranker.rank({
      preference: { ...preference, interests: ['cafe'], preferences: ['local'] },
      places: [franchiseCafe, localCafe],
      crowd,
      locale: 'ko',
    });

    const rankedLocal = result.candidates.find((c) => c.place.placeId === 'local-bakery');
    const rankedFranchise = result.candidates.find((c) => c.place.placeId === 'starbucks-ss');

    expect(rankedLocal?.scoreBreakdown.localImpact).toBe(1.0); // 0.9 + 0.1(길)
    expect(rankedFranchise?.scoreBreakdown.localImpact).toBe(0.2);
    expect(rankedLocal!.scoreBreakdown.total).toBeGreaterThan(
      rankedFranchise!.scoreBreakdown.total,
    );
    expect(rankedLocal!.reason).toContain('로컬 발견 휴리스틱은 100%');
    expect(rankedLocal!.reason).toContain('공식 독립매장 인증이 아닙니다');

    expect(result.weights.localImpact).toBeGreaterThan(0.15);
  });

  it('filters out medical clinics and cosmetic surgery facilities from candidate ranking', () => {
    const clinic1 = place('clinic-1', 'attraction', 126.92, 37.55, {
      name: 'Kleamクリニック',
      rawCategory: 'kto:76:A02:A0202:A02020500',
    });
    const clinic2 = place('clinic-2', 'medical', 126.92, 37.55, {
      name: 'ホンデid美容クリニック',
      rawCategory: 'kto:76:A02:A0202:A02020500',
    });
    const touristSpot = place('night-view-1', 'attraction', 126.92, 37.55, {
      name: '홍대 걷고싶은거리',
      rawCategory: '명소>거리',
    });

    const result = ranker.rank({
      preference: { ...preference, interests: ['attraction', 'photography'] },
      places: [clinic1, clinic2, touristSpot],
      crowd,
    });

    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]?.place.placeId).toBe('night-view-1');
  });
});
