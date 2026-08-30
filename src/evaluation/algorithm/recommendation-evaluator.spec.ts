import {
  evaluateBaselineAndMichi,
  type EvaluationCandidateInput,
} from './recommendation-evaluator';

function tourismFeature(value: number): EvaluationCandidateInput['tourismFeatures'] {
  return {
    visitor_count: { value, peerValues: [10, 20, 30, 40] },
  };
}

function candidate(
  id: string,
  overrides: Partial<EvaluationCandidateInput> = {},
): EvaluationCandidateInput {
  return {
    id,
    preferenceScore: 0.8,
    popularityScore: 0.7,
    distanceScore: 0.8,
    timeScore: 0.8,
    distanceKm: 2,
    travelTimeMinutes: 20,
    ...overrides,
  };
}

describe('baseline and Michi recommendation evaluation', () => {
  it('uses the same immutable candidate input but changes direction with tourism dispersion', () => {
    const candidates = [
      candidate('hotspot', {
        preferenceScore: 0.9,
        popularityScore: 1,
        distanceScore: 1,
        timeScore: 1,
        tourismFeatures: tourismFeature(40),
        alternativeSimilarity: 0.2,
        tourismFlow: 0.2,
      }),
      candidate('local', {
        preferenceScore: 0.88,
        popularityScore: 0.85,
        distanceScore: 0.9,
        timeScore: 0.9,
        tourismFeatures: tourismFeature(10),
        alternativeSimilarity: 1,
        tourismFlow: 1,
      }),
    ];
    const before = structuredClone(candidates);

    const report = evaluateBaselineAndMichi({ candidates, limit: 1 });

    expect(report.inputCandidateIds).toEqual(['hotspot', 'local']);
    expect(report.baseline.selected[0]?.id).toBe('hotspot');
    expect(report.michi.selected[0]?.id).toBe('local');
    expect(report.michi.selected[0]?.dispersion).toBeGreaterThan(
      report.baseline.selected[0]?.dispersion ?? 0,
    );
    expect(candidates).toEqual(before);
  });

  it('enforces the preference threshold before applying local impact', () => {
    const report = evaluateBaselineAndMichi({
      candidates: [
        candidate('below-threshold', {
          preferenceScore: 0.59,
          popularityScore: 1,
          distanceScore: 1,
          timeScore: 1,
          tourismFeatures: tourismFeature(10),
          alternativeSimilarity: 1,
          tourismFlow: 1,
        }),
        candidate('eligible', { preferenceScore: 0.6, tourismFeatures: tourismFeature(40) }),
      ],
    });

    expect(report.baseline.ranked.map((entry) => entry.id)).toContain('below-threshold');
    expect(report.michi.ranked.map((entry) => entry.id)).toEqual(['eligible']);
    expect(report.baseline.ranked.find((entry) => entry.id === 'below-threshold')).toMatchObject({
      localImpact: null,
      localImpactEvidence: { eligible: false },
    });
  });

  it('falls back to the baseline quality order and does not invent tourism metrics', () => {
    const report = evaluateBaselineAndMichi({
      candidates: [
        candidate('second', { popularityScore: 0.4 }),
        candidate('first', { popularityScore: 0.9 }),
      ],
      limit: 2,
    });

    expect(report.michi.ranked.map((entry) => entry.id)).toEqual(
      report.baseline.ranked.map((entry) => entry.id),
    );
    expect(report.michi.ranked.every((entry) => entry.fallbackToBaseline)).toBe(true);
    expect(report.baseline.metrics).toMatchObject({
      tourismConcentrationScore: null,
      nonHotspotInclusionRate: null,
      localImpactScore: null,
    });
    expect(report.michi.metrics).toMatchObject({
      tourismConcentrationScore: null,
      nonHotspotInclusionRate: null,
      localImpactScore: null,
    });
    expect(report.delta).toMatchObject({
      tourismConcentrationScore: null,
      nonHotspotInclusionRate: null,
      localImpactScore: null,
    });
    expect(report.expectedEffect).toMatchObject({
      algorithmVersion: 'expected-dispersion-effect-v1',
      claimScope: 'recommendation_estimate',
      evidenceStatus: 'partial',
      concentrationReduction: null,
      nonHotspotInclusionLift: null,
      preferenceChange: 0,
      extraTravelDistanceKm: 0,
      extraTravelTimeMinutes: 0,
      localImpactLift: null,
    });
  });

  it('calculates reproducible metrics, Michi-minus-Baseline deltas, and expected dispersion effects', () => {
    const report = evaluateBaselineAndMichi({
      candidates: [
        candidate('hotspot', {
          preferenceScore: 0.9,
          popularityScore: 1,
          distanceKm: 1,
          travelTimeMinutes: 10,
          tourismFeatures: tourismFeature(40),
          alternativeSimilarity: 0.2,
          tourismFlow: 0.2,
        }),
        candidate('local', {
          preferenceScore: 0.8,
          popularityScore: 0.5,
          distanceKm: 3,
          travelTimeMinutes: 30,
          tourismFeatures: tourismFeature(10),
          alternativeSimilarity: 1,
          tourismFlow: 1,
        }),
      ],
      limit: 1,
      nonHotspotThreshold: 0.5,
    });

    expect(report.baseline.metrics).toMatchObject({
      averagePreferenceScore: 0.9,
      nonHotspotInclusionRate: 0,
      averageTravelDistanceKm: 1,
      averageTravelTimeMinutes: 10,
    });
    expect(report.michi.metrics).toMatchObject({
      averagePreferenceScore: 0.8,
      nonHotspotInclusionRate: 1,
      averageTravelDistanceKm: 3,
      averageTravelTimeMinutes: 30,
    });
    expect(report.delta).toMatchObject({
      averagePreferenceScore: -0.1,
      nonHotspotInclusionRate: 1,
      averageTravelDistanceKm: 2,
      averageTravelTimeMinutes: 20,
    });
    expect(report.delta.tourismConcentrationScore).toBeLessThan(0);
    expect(report.delta.localImpactScore).toBeGreaterThan(0);

    // ExpectedDispersionEffect assertions
    expect(report.expectedEffect).toMatchObject({
      algorithmVersion: 'expected-dispersion-effect-v1',
      claimScope: 'recommendation_estimate',
      evidenceStatus: 'available',
      nonHotspotInclusionLift: 1,
      preferenceChange: -0.1,
      extraTravelDistanceKm: 2,
      extraTravelTimeMinutes: 20,
    });
    expect(report.expectedEffect.concentrationReduction).toBeGreaterThan(0);
    expect(report.expectedEffect.localImpactLift).toBeGreaterThan(0);
  });
});
