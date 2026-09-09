import {
  completedItineraryEligibility,
  type CompletionEligibilityInput,
} from './completed-itinerary-eligibility';

const stop = (
  input: {
    type?: string;
    name?: string;
    category?: string;
    rawCategory?: string;
    duration?: number;
    evidence?: string;
    stay?: number;
  } = {},
): CompletionEligibilityInput['stops'][number] => ({
  stopType: input.type ?? 'general',
  estimatedStayMinutes: input.stay ?? 60,
  name: input.name,
  category: input.category,
  rawCategory: input.rawCategory,
  inboundRoute:
    input.duration == null
      ? null
      : { durationMinutes: input.duration, evidence: input.evidence ?? 'measured' },
});

describe('completedItineraryEligibility', () => {
  it('counts only measured or mixed inbound-route evidence toward 4–6 hour coverage', () => {
    expect(
      completedItineraryEligibility({
        startTime: '13:00',
        endTime: '17:00',
        requestedMeal: false,
        requestedThemes: [],
        stops: [stop({ stay: 60, duration: 240, evidence: 'estimated' })],
      }),
    ).toEqual({ eligible: false, code: 'INSUFFICIENT_VERIFIED_COVERAGE' });
    expect(
      completedItineraryEligibility({
        startTime: '13:00',
        endTime: '17:00',
        requestedMeal: false,
        requestedThemes: [],
        stops: [stop({ stay: 60, duration: 84, evidence: 'mixed' })],
      }),
    ).toEqual({ eligible: true });
  });

  it('requires each explicit theme and a meal stop', () => {
    expect(
      completedItineraryEligibility({
        startTime: '10:00',
        endTime: '11:00',
        requestedMeal: true,
        requestedThemes: ['한옥'],
        stops: [stop({ type: 'meal', category: 'restaurant', name: '한식당' })],
      }),
    ).toEqual({ eligible: false, code: 'THEME_EVIDENCE_MISSING' });
    expect(
      completedItineraryEligibility({
        startTime: '10:00',
        endTime: '11:00',
        requestedMeal: true,
        requestedThemes: ['한옥', '문화'],
        stops: [
          stop({ type: 'meal', category: 'restaurant' }),
          stop({ name: '북촌 한옥마을', rawCategory: '전통 문화 관광지' }),
        ],
      }),
    ).toEqual({ eligible: true });
  });

  it('does not treat a generic Hongdae walk as a required park, but keeps explicit place themes hard', () => {
    const hongdaeLunchAndCafe = [
      stop({
        type: 'meal',
        name: '홍대 점심 식당',
        category: 'restaurant',
        stay: 60,
        duration: 12,
      }),
      stop({ name: '홍대 카페', category: 'cafe', stay: 105, duration: 18, evidence: 'mixed' }),
      stop({
        name: '홍대 골목 산책',
        category: 'general',
        stay: 90,
        duration: 15,
        evidence: 'measured',
      }),
    ];
    expect(
      completedItineraryEligibility({
        startTime: '13:00',
        endTime: '18:00',
        requestedMeal: true,
        requestedThemes: ['cafe', '산책'],
        stops: hongdaeLunchAndCafe,
      }),
    ).toEqual({ eligible: true });
    expect(
      completedItineraryEligibility({
        startTime: '13:00',
        endTime: '18:00',
        requestedMeal: true,
        requestedThemes: ['공원'],
        stops: hongdaeLunchAndCafe,
      }),
    ).toEqual({ eligible: false, code: 'THEME_EVIDENCE_MISSING' });
    expect(
      completedItineraryEligibility({
        startTime: '13:00',
        endTime: '18:00',
        requestedMeal: true,
        requestedThemes: ['한옥'],
        stops: hongdaeLunchAndCafe,
      }),
    ).toEqual({ eligible: false, code: 'THEME_EVIDENCE_MISSING' });
  });
});
