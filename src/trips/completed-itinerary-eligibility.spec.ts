import {
  completedItineraryPublicationValidation,
  completedItineraryEligibility,
  isPublicationPolicyOnlyToken,
  publicationThemeFromPreference,
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
  it('keeps operational preferences out of required place evidence while preserving visitable themes', () => {
    expect(publicationThemeFromPreference('quiet')).toBeNull();
    expect(publicationThemeFromPreference('子ども連れ')).toBeNull();
    expect(publicationThemeFromPreference('歩きすぎない')).toBeNull();
    expect(publicationThemeFromPreference('사진 촬영')).toBe('photography');
    expect(publicationThemeFromPreference('벚꽃 피크닉')).toBe('park');
    expect(publicationThemeFromPreference('韓屋')).toBe('한옥');
    expect(isPublicationPolicyOnlyToken('실내')).toBe(true);
    expect(isPublicationPolicyOnlyToken('유모차 이동 편리')).toBe(true);
  });

  it('does not treat local meal policy markers as required place themes', () => {
    expect(isPublicationPolicyOnlyToken('local')).toBe(true);
    expect(isPublicationPolicyOnlyToken('local_specialty')).toBe(true);
    expect(isPublicationPolicyOnlyToken('stroll')).toBe(false);

    const validation = completedItineraryPublicationValidation({
      startTime: '13:00',
      endTime: '18:00',
      requestedMeal: true,
      requestedThemes: ['cafe', 'local'],
      stops: [
        stop({ type: 'meal', category: 'restaurant', stay: 60 }),
        stop({ category: 'cafe', stay: 120 }),
      ],
      area: { valid: true },
      time: { valid: true },
    });

    expect(validation.publicationStatus).toBe('ready');
    expect(validation.requiredActivities).toEqual({ status: 'pass', missing: [] });
  });

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
    expect(
      completedItineraryEligibility({
        startTime: '10:00',
        endTime: '11:00',
        requestedMeal: false,
        requestedThemes: ['stroll'],
        stops: [stop({ name: '北村八景（북촌 8경）', category: 'attraction' })],
      }),
    ).toEqual({ eligible: true });
  });

  it('does not treat a generic Hongdae walk as a stroll place, while keeping explicit themes hard', () => {
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
        startTime: '10:00',
        endTime: '11:00',
        requestedMeal: true,
        requestedThemes: ['cafe', '산책'],
        stops: hongdaeLunchAndCafe,
      }),
    ).toEqual({ eligible: false, code: 'THEME_EVIDENCE_MISSING' });
    expect(
      completedItineraryEligibility({
        startTime: '10:00',
        endTime: '11:00',
        requestedMeal: true,
        requestedThemes: ['공원'],
        stops: hongdaeLunchAndCafe,
      }),
    ).toEqual({ eligible: false, code: 'THEME_EVIDENCE_MISSING' });
    expect(
      completedItineraryEligibility({
        startTime: '10:00',
        endTime: '11:00',
        requestedMeal: true,
        requestedThemes: ['한옥'],
        stops: hongdaeLunchAndCafe,
      }),
    ).toEqual({ eligible: false, code: 'THEME_EVIDENCE_MISSING' });
  });

  it('requires a stroll place and accepts park or stroll categories for that role', () => {
    expect(
      completedItineraryEligibility({
        startTime: '10:00',
        endTime: '11:00',
        requestedMeal: false,
        requestedThemes: ['stroll'],
        stops: [stop({ name: '홍대 카페', category: 'cafe' })],
      }),
    ).toEqual({ eligible: false, code: 'THEME_EVIDENCE_MISSING' });
    expect(
      completedItineraryEligibility({
        startTime: '10:00',
        endTime: '11:00',
        requestedMeal: false,
        requestedThemes: ['stroll'],
        stops: [stop({ name: '한강 산책로', category: 'stroll' })],
      }),
    ).toEqual({ eligible: true });
    expect(
      completedItineraryEligibility({
        startTime: '10:00',
        endTime: '11:00',
        requestedMeal: false,
        requestedThemes: ['stroll'],
        stops: [stop({ name: '서울숲', category: 'park' })],
      }),
    ).toEqual({ eligible: true });
  });

  it('returns a blocked publication contract with required activity and area/time checks', () => {
    const validation = completedItineraryPublicationValidation({
      startTime: '13:00',
      endTime: '14:00',
      requestedMeal: true,
      requestedThemes: ['산책'],
      stops: [stop({ category: 'restaurant', type: 'meal' })],
      area: { valid: false, outsidePlaceIds: ['outside-1'] },
      time: { valid: true },
    });

    expect(validation).toEqual({
      publicationStatus: 'blocked',
      requiredActivities: { status: 'fail', missing: ['산책'] },
      area: { status: 'fail', outsidePlaceIds: ['outside-1'] },
      time: { status: 'pass', violations: [] },
      failureCodes: ['THEME_EVIDENCE_MISSING', 'AREA_CONSTRAINTS_VIOLATED'],
    });
  });

  it('keeps a normal 13:00–14:00 stay publication-ready when hard checks pass', () => {
    const validation = completedItineraryPublicationValidation({
      startTime: '13:00',
      endTime: '14:00',
      requestedMeal: false,
      requestedThemes: [],
      stops: [stop({ category: 'restaurant', stay: 60 })],
      area: { valid: true },
      time: { valid: true },
    });

    expect(validation.publicationStatus).toBe('ready');
    expect(validation.time).toEqual({ status: 'pass', violations: [] });
  });
});
