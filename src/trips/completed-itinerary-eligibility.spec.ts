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
});
