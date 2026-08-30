import {
  calculateExpectedDispersionEffect,
  EXPECTED_DISPERSION_EFFECT_ALGORITHM_VERSION,
  type MetricSourceValues,
} from './expected-dispersion-effect';

describe('ExpectedDispersionEffect v1', () => {
  const baseBaseline: MetricSourceValues = {
    averagePreferenceScore: 0.9,
    tourismConcentrationScore: 0.85,
    nonHotspotInclusionRate: 0.1,
    averageTravelDistanceKm: 1.2,
    averageTravelTimeMinutes: 12.0,
    localImpactScore: 0.25,
  };

  const baseMichi: MetricSourceValues = {
    averagePreferenceScore: 0.82,
    tourismConcentrationScore: 0.35,
    nonHotspotInclusionRate: 0.9,
    averageTravelDistanceKm: 2.5,
    averageTravelTimeMinutes: 25.0,
    localImpactScore: 0.75,
  };

  it('calculates positive concentrationReduction when Michi has lower concentration (Baseline - Michi)', () => {
    const effect = calculateExpectedDispersionEffect(baseBaseline, baseMichi);

    expect(effect.concentrationReduction).toBe(0.5); // 0.85 - 0.35 = 0.50
    expect(effect.concentrationReduction).toBeGreaterThan(0);
  });

  it('calculates positive nonHotspotInclusionLift when Michi includes more non-hotspots (Michi - Baseline)', () => {
    const effect = calculateExpectedDispersionEffect(baseBaseline, baseMichi);

    expect(effect.nonHotspotInclusionLift).toBe(0.8); // 0.9 - 0.1 = 0.8
    expect(effect.nonHotspotInclusionLift).toBeGreaterThan(0);
  });

  it('calculates preferenceChange as Michi - Baseline (negative indicates preference trade-off)', () => {
    const effect = calculateExpectedDispersionEffect(baseBaseline, baseMichi);

    expect(effect.preferenceChange).toBe(-0.08); // 0.82 - 0.90 = -0.08
  });

  it('calculates extra travel distance and time as Michi - Baseline (positive indicates additional burden)', () => {
    const effect = calculateExpectedDispersionEffect(baseBaseline, baseMichi);

    expect(effect.extraTravelDistanceKm).toBe(1.3); // 2.5 - 1.2 = 1.3
    expect(effect.extraTravelTimeMinutes).toBe(13.0); // 25.0 - 12.0 = 13.0
  });

  it('calculates localImpactLift as Michi - Baseline (positive indicates improved local discovery proxy)', () => {
    const effect = calculateExpectedDispersionEffect(baseBaseline, baseMichi);

    expect(effect.localImpactLift).toBe(0.5); // 0.75 - 0.25 = 0.50
  });

  it('returns 0 for all metrics when Baseline and Michi metrics are identical', () => {
    const effect = calculateExpectedDispersionEffect(baseBaseline, baseBaseline);

    expect(effect.concentrationReduction).toBe(0);
    expect(effect.nonHotspotInclusionLift).toBe(0);
    expect(effect.preferenceChange).toBe(0);
    expect(effect.extraTravelDistanceKm).toBe(0);
    expect(effect.extraTravelTimeMinutes).toBe(0);
    expect(effect.localImpactLift).toBe(0);
    expect(effect.evidenceStatus).toBe('available');
    expect(effect.claimScope).toBe('recommendation_estimate');
    expect(effect.algorithmVersion).toBe(EXPECTED_DISPERSION_EFFECT_ALGORITHM_VERSION);
  });

  it('preserves null values without inventing or coercing to zero', () => {
    const partialBaseline: MetricSourceValues = {
      averagePreferenceScore: 0.8,
      tourismConcentrationScore: null,
      nonHotspotInclusionRate: null,
      averageTravelDistanceKm: 1.0,
      averageTravelTimeMinutes: 10.0,
      localImpactScore: null,
    };
    const partialMichi: MetricSourceValues = {
      averagePreferenceScore: 0.8,
      tourismConcentrationScore: null,
      nonHotspotInclusionRate: null,
      averageTravelDistanceKm: 1.5,
      averageTravelTimeMinutes: 15.0,
      localImpactScore: null,
    };

    const effect = calculateExpectedDispersionEffect(partialBaseline, partialMichi);

    expect(effect.concentrationReduction).toBeNull();
    expect(effect.nonHotspotInclusionLift).toBeNull();
    expect(effect.localImpactLift).toBeNull();
    expect(effect.preferenceChange).toBe(0);
    expect(effect.extraTravelDistanceKm).toBe(0.5);
    expect(effect.extraTravelTimeMinutes).toBe(5.0);
  });

  it('sets evidenceStatus to available when both core dispersion metrics exist', () => {
    const effect = calculateExpectedDispersionEffect(baseBaseline, baseMichi);

    expect(effect.evidenceStatus).toBe('available');
  });

  it('sets evidenceStatus to partial when some metrics exist but core tourism metrics are missing or incomplete', () => {
    const partialBaseline: MetricSourceValues = {
      averagePreferenceScore: 0.8,
      tourismConcentrationScore: 0.7,
      nonHotspotInclusionRate: null,
      averageTravelDistanceKm: null,
      averageTravelTimeMinutes: null,
      localImpactScore: null,
    };
    const partialMichi: MetricSourceValues = {
      averagePreferenceScore: 0.8,
      tourismConcentrationScore: 0.5,
      nonHotspotInclusionRate: null,
      averageTravelDistanceKm: null,
      averageTravelTimeMinutes: null,
      localImpactScore: null,
    };

    const effect = calculateExpectedDispersionEffect(partialBaseline, partialMichi);

    expect(effect.concentrationReduction).toBe(0.2);
    expect(effect.nonHotspotInclusionLift).toBeNull();
    expect(effect.evidenceStatus).toBe('partial');
  });

  it('sets evidenceStatus to unavailable when all comparable metrics are null', () => {
    const nullBaseline: MetricSourceValues = {
      averagePreferenceScore: null,
      tourismConcentrationScore: null,
      nonHotspotInclusionRate: null,
      averageTravelDistanceKm: null,
      averageTravelTimeMinutes: null,
      localImpactScore: null,
    };
    const nullMichi: MetricSourceValues = {
      averagePreferenceScore: null,
      tourismConcentrationScore: null,
      nonHotspotInclusionRate: null,
      averageTravelDistanceKm: null,
      averageTravelTimeMinutes: null,
      localImpactScore: null,
    };

    const effect = calculateExpectedDispersionEffect(nullBaseline, nullMichi);

    expect(effect.evidenceStatus).toBe('unavailable');
    expect(effect.concentrationReduction).toBeNull();
    expect(effect.nonHotspotInclusionLift).toBeNull();
    expect(effect.preferenceChange).toBeNull();
    expect(effect.extraTravelDistanceKm).toBeNull();
    expect(effect.extraTravelTimeMinutes).toBeNull();
    expect(effect.localImpactLift).toBeNull();
  });

  it('does not mutate input objects and returns deterministic results across repeated invocations', () => {
    const baselineSnapshot = structuredClone(baseBaseline);
    const michiSnapshot = structuredClone(baseMichi);

    const effect1 = calculateExpectedDispersionEffect(baseBaseline, baseMichi);
    const effect2 = calculateExpectedDispersionEffect(baseBaseline, baseMichi);

    expect(baseBaseline).toEqual(baselineSnapshot);
    expect(baseMichi).toEqual(michiSnapshot);
    expect(effect1).toEqual(effect2);
  });
});
