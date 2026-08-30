import { DeterministicItineraryExplanationProvider } from './deterministic-itinerary-explanation.provider';
import type { ItineraryExplanationInput } from './itinerary-explanation.types';

describe('DeterministicItineraryExplanationProvider', () => {
  let provider: DeterministicItineraryExplanationProvider;

  beforeEach(() => {
    provider = new DeterministicItineraryExplanationProvider();
  });

  const sampleInputKo: ItineraryExplanationInput = {
    locale: 'ko',
    preference: {
      area: '성수',
      totalDays: 2,
      startTime: '10:00',
      endTime: '20:00',
      interests: ['cafe', 'culture'],
      preferences: ['quiet'],
      avoid: ['crowded'],
    },
    stops: [
      {
        order: 1,
        dayNumber: 1,
        dayDate: '2026-08-29',
        placeId: 'p1',
        placeName: '성수 미술관 카페',
        category: 'cafe',
        district: '성동구',
        stopType: 'general',
        arrivalAt: '10:00',
        leaveAt: '11:30',
        estimatedStayMinutes: 90,
        estimatedCost: 15000,
        reason: '성수 조용한 분위기의 대표 카페입니다.',
        scoreBreakdown: { total: 0.88 },
        inboundRoute: null,
        nextLegRoute: {
          durationMinutes: 12,
          distanceKm: 0.8,
          transportMode: 'walk',
          evidence: 'estimated',
        },
      },
      {
        order: 2,
        dayNumber: 1,
        dayDate: '2026-08-29',
        placeId: 'p2',
        placeName: '서울숲 갤러리',
        category: 'museum',
        district: '성동구',
        stopType: 'must_visit',
        arrivalAt: '11:42',
        leaveAt: '13:00',
        estimatedStayMinutes: 78,
        estimatedCost: 20000,
        reason: '사용자 필수 방문 장소입니다.',
        scoreBreakdown: { total: 0.95 },
        inboundRoute: {
          durationMinutes: 12,
          distanceKm: 0.8,
          transportMode: 'walk',
          evidence: 'estimated',
        },
        nextLegRoute: null,
      },
      {
        order: 3,
        dayNumber: 2,
        dayDate: '2026-08-30',
        placeId: 'p3',
        placeName: '한남동 쇼룸',
        category: 'shopping',
        district: '용산구',
        stopType: 'general',
        arrivalAt: '10:00',
        leaveAt: '11:30',
        estimatedStayMinutes: 90,
        estimatedCost: null,
        reason: '한남동 트렌디 쇼룸입니다.',
        scoreBreakdown: { total: 0.82 },
        inboundRoute: null,
        nextLegRoute: null,
      },
    ],
  };

  it('generates deterministic Korean explanations with correct day boundary handling', async () => {
    const result = await provider.generate(sampleInputKo, 'mock');

    expect(result.locale).toBe('ko');
    expect(result.mode).toBe('mock');
    expect(result.tripSummary).toContain('성수 지역 중심의');
    expect(result.tripSummary).toContain('2일 여행 일정입니다.');
    expect(result.stops).toHaveLength(3);

    // Stop 1: First stop of Day 1
    const s1 = result.stops[0]!;
    expect(s1.order).toBe(1);
    expect(s1.placeId).toBe('p1');
    expect(s1.shortDescription).toContain('성수 미술관 카페는 성동구에 위치한 카페입니다.');
    expect(s1.shortDescription).not.toContain('은(는)');
    expect(s1.previousStopFit).toBeNull();
    expect(s1.nextStopFit).toContain('서울숲 갤러리');
    expect(s1.nextStopFit).toContain('12분');
    expect(s1.nextStopFit).not.toContain('(으)로');
    expect(s1.overallTripFit).toBe('성수 조용한 분위기의 대표 카페입니다.');

    // Stop 2: Last stop of Day 1
    const s2 = result.stops[1]!;
    expect(s2.order).toBe(2);
    expect(s2.placeId).toBe('p2');
    expect(s2.previousStopFit).toContain('성수 미술관 카페');
    expect(s2.previousStopFit).toContain('12분');
    expect(s2.nextStopFit).toBeNull(); // Day boundary to Day 2

    // Stop 3: First and only stop of Day 2
    const s3 = result.stops[2]!;
    expect(s3.order).toBe(3);
    expect(s3.placeId).toBe('p3');
    expect(s3.shortDescription).toContain('한남동 쇼룸은 용산구에 위치한 쇼핑 명소입니다.');
    expect(s3.shortDescription).not.toContain('은(는)');
    expect(s3.previousStopFit).toBeNull(); // First stop of Day 2
    expect(s3.nextStopFit).toBeNull(); // Last stop of Day 2 & trip
  });

  it('generates deterministic Japanese explanations for ja locale', async () => {
    const sampleInputJa: ItineraryExplanationInput = {
      ...sampleInputKo,
      locale: 'ja',
    };

    const result = await provider.generate(sampleInputJa, 'live');

    expect(result.locale).toBe('ja');
    expect(result.tripSummary).toContain('聖水（ソンス）エリアを中心とした');
    expect(result.tripSummary).toContain('2日間の旅行日程です。');
    expect(result.stops[0]!.shortDescription).toContain('カフェです。');
    expect(result.stops[0]!.previousStopFit).toBeNull();
    expect(result.stops[0]!.nextStopFit).toContain('次スポット');
    expect(result.stops[0]!.overallTripFit).not.toContain('動선');
    expect(result.stops[0]!.overallTripFit).not.toContain('cafe');
  });
});
