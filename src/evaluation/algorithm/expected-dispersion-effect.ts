export const EXPECTED_DISPERSION_EFFECT_ALGORITHM_VERSION = 'expected-dispersion-effect-v1';

export type ExpectedDispersionEvidenceStatus = 'available' | 'partial' | 'unavailable';

export interface ExpectedDispersionEffect {
  algorithmVersion: string;
  claimScope: 'recommendation_estimate';
  evidenceStatus: ExpectedDispersionEvidenceStatus;

  concentrationReduction: number | null;
  nonHotspotInclusionLift: number | null;
  preferenceChange: number | null;
  extraTravelDistanceKm: number | null;
  extraTravelTimeMinutes: number | null;
  localImpactLift: number | null;
}

export interface MetricSourceValues {
  averagePreferenceScore: number | null;
  tourismConcentrationScore: number | null;
  nonHotspotInclusionRate: number | null;
  averageTravelDistanceKm: number | null;
  averageTravelTimeMinutes: number | null;
  localImpactScore: number | null;
}

function calculateDifference(left: number | null, right: number | null): number | null {
  if (left === null || right === null || !Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }
  return Number((left - right).toFixed(6));
}

/**
 * Calculates the ExpectedDispersionEffect v1.
 *
 * Direction of each metric:
 * - concentrationReduction = Baseline tourism concentration - Michi tourism concentration
 *   (positive means lower concentration in Michi, favorable for dispersion)
 * - nonHotspotInclusionLift = Michi non-hotspot rate - Baseline non-hotspot rate
 *   (positive means higher non-hotspot inclusion in Michi)
 * - preferenceChange = Michi average preference - Baseline average preference
 *   (negative means some preference trade-off for dispersion)
 * - extraTravelDistanceKm = Michi travel distance - Baseline travel distance
 *   (positive means additional travel burden)
 * - extraTravelTimeMinutes = Michi travel time - Baseline travel time
 *   (positive means additional travel burden)
 * - localImpactLift = Michi local impact - Baseline local impact
 *   (positive means higher local discovery proxy)
 *
 * Evidence status:
 * - 'available': both core dispersion metrics (concentrationReduction and nonHotspotInclusionLift) are non-null
 * - 'partial': some metrics are non-null, but not both core dispersion metrics
 * - 'unavailable': all comparable metrics are null
 */
export function calculateExpectedDispersionEffect(
  baseline: MetricSourceValues,
  michi: MetricSourceValues,
): ExpectedDispersionEffect {
  const concentrationReduction = calculateDifference(
    baseline.tourismConcentrationScore,
    michi.tourismConcentrationScore,
  );

  const nonHotspotInclusionLift = calculateDifference(
    michi.nonHotspotInclusionRate,
    baseline.nonHotspotInclusionRate,
  );

  const preferenceChange = calculateDifference(
    michi.averagePreferenceScore,
    baseline.averagePreferenceScore,
  );

  const extraTravelDistanceKm = calculateDifference(
    michi.averageTravelDistanceKm,
    baseline.averageTravelDistanceKm,
  );

  const extraTravelTimeMinutes = calculateDifference(
    michi.averageTravelTimeMinutes,
    baseline.averageTravelTimeMinutes,
  );

  const localImpactLift = calculateDifference(michi.localImpactScore, baseline.localImpactScore);

  const allMetrics = [
    concentrationReduction,
    nonHotspotInclusionLift,
    preferenceChange,
    extraTravelDistanceKm,
    extraTravelTimeMinutes,
    localImpactLift,
  ];

  let evidenceStatus: ExpectedDispersionEvidenceStatus = 'unavailable';
  if (concentrationReduction !== null && nonHotspotInclusionLift !== null) {
    evidenceStatus = 'available';
  } else if (allMetrics.some((value) => value !== null)) {
    evidenceStatus = 'partial';
  }

  return {
    algorithmVersion: EXPECTED_DISPERSION_EFFECT_ALGORITHM_VERSION,
    claimScope: 'recommendation_estimate',
    evidenceStatus,
    concentrationReduction,
    nonHotspotInclusionLift,
    preferenceChange,
    extraTravelDistanceKm,
    extraTravelTimeMinutes,
    localImpactLift,
  };
}
