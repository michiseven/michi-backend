import {
  calculateLocalImpact,
  DEFAULT_PREFERENCE_THRESHOLD,
  type LocalImpactResult,
} from '../../tourism-feature/local-impact';
import { finiteUnit, roundScore, weightedAvailableScore } from '../../tourism-feature/score-utils';
import {
  calculateTourismConcentration,
  type TourismConcentrationInput,
  type TourismConcentrationResult,
} from '../../tourism-feature/tourism-concentration';

import {
  calculateExpectedDispersionEffect,
  EXPECTED_DISPERSION_EFFECT_ALGORITHM_VERSION,
  type ExpectedDispersionEffect,
  type ExpectedDispersionEvidenceStatus,
} from './expected-dispersion-effect';

export {
  calculateExpectedDispersionEffect,
  EXPECTED_DISPERSION_EFFECT_ALGORITHM_VERSION,
  type ExpectedDispersionEffect,
  type ExpectedDispersionEvidenceStatus,
};

export const BASELINE_ALGORITHM_VERSION = 'baseline-preference-popularity-distance-time-v1';
export const MICHI_ALGORITHM_VERSION = 'michi-tourism-dispersion-v1';
export const EVALUATION_ALGORITHM_VERSION = 'baseline-vs-michi-evaluation-v1';

export const BASELINE_WEIGHTS = Object.freeze({
  preference: 0.4,
  popularity: 0.25,
  distance: 0.2,
  time: 0.15,
});

export const MICHI_WEIGHTS = Object.freeze({
  baselineQuality: 0.7,
  tourismDispersion: 0.15,
  localImpact: 0.15,
});

export interface EvaluationCandidateInput {
  id: string;
  preferenceScore: number;
  popularityScore: number | null;
  distanceScore: number;
  timeScore: number;
  distanceKm: number | null;
  travelTimeMinutes: number | null;
  tourismFeatures?: TourismConcentrationInput;
  tourismResult?: TourismConcentrationResult;
  alternativeSimilarity?: number | null;
  tourismFlow?: number | null;
}

export interface EvaluatedCandidate {
  id: string;
  rank: number;
  algorithmScore: number;
  baselineQualityScore: number;
  preferenceScore: number;
  distanceKm: number | null;
  travelTimeMinutes: number | null;
  concentration: number | null;
  dispersion: number | null;
  localImpact: number | null;
  tourism: TourismConcentrationResult;
  localImpactEvidence: LocalImpactResult;
  fallbackToBaseline: boolean;
}

export interface EvaluationMetrics {
  averagePreferenceScore: number | null;
  tourismConcentrationScore: number | null;
  nonHotspotInclusionRate: number | null;
  averageTravelDistanceKm: number | null;
  averageTravelTimeMinutes: number | null;
  localImpactScore: number | null;
}

export interface RecommendationEvaluationVariant {
  algorithmVersion: string;
  ranked: EvaluatedCandidate[];
  selected: EvaluatedCandidate[];
  metrics: EvaluationMetrics;
}

export interface EvaluationDelta {
  averagePreferenceScore: number | null;
  tourismConcentrationScore: number | null;
  nonHotspotInclusionRate: number | null;
  averageTravelDistanceKm: number | null;
  averageTravelTimeMinutes: number | null;
  localImpactScore: number | null;
}

export interface RecommendationEvaluationInput {
  candidates: ReadonlyArray<EvaluationCandidateInput>;
  limit?: number;
  preferenceThreshold?: number;
  nonHotspotThreshold?: number;
}

export interface RecommendationEvaluationReport {
  algorithmVersion: string;
  inputCandidateIds: string[];
  preferenceThreshold: number;
  nonHotspotThreshold: number;
  baseline: RecommendationEvaluationVariant;
  michi: RecommendationEvaluationVariant;
  /**
   * Every raw delta metric is calculated as (Michi - Baseline).
   * Notice that for tourism concentration, negative means concentration reduction in Michi.
   */
  delta: EvaluationDelta;
  /**
   * Recommendation-estimate based ExpectedDispersionEffect v1.
   * Notice that concentrationReduction is oriented as (Baseline - Michi),
   * where positive numbers denote favorable dispersion.
   */
  expectedEffect: ExpectedDispersionEffect;
}

interface CandidateEvidence {
  candidate: EvaluationCandidateInput;
  originalIndex: number;
  baselineQualityScore: number;
  tourism: TourismConcentrationResult;
  localImpact: LocalImpactResult;
}

function baselineQualityScore(candidate: EvaluationCandidateInput): number {
  return (
    weightedAvailableScore(
      {
        preference: candidate.preferenceScore,
        popularity: candidate.popularityScore,
        distance: candidate.distanceScore,
        time: candidate.timeScore,
      },
      BASELINE_WEIGHTS,
    ).score ?? 0
  );
}

function finiteNonNegative(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function evidenceFor(
  candidate: EvaluationCandidateInput,
  originalIndex: number,
  preferenceThreshold: number,
): CandidateEvidence {
  const tourism =
    candidate.tourismResult ?? calculateTourismConcentration(candidate.tourismFeatures ?? {});
  return {
    candidate,
    originalIndex,
    baselineQualityScore: baselineQualityScore(candidate),
    tourism,
    localImpact: calculateLocalImpact({
      preferenceScore: candidate.preferenceScore,
      dispersion: tourism.dispersion,
      alternativeSimilarity: candidate.alternativeSimilarity ?? null,
      tourismFlow: candidate.tourismFlow ?? null,
      preferenceThreshold,
    }),
  };
}

function evaluatedCandidate(
  evidence: CandidateEvidence,
  algorithmScore: number,
  fallbackToBaseline: boolean,
): EvaluatedCandidate {
  return {
    id: evidence.candidate.id,
    rank: 0,
    algorithmScore: roundScore(algorithmScore),
    baselineQualityScore: evidence.baselineQualityScore,
    preferenceScore: finiteUnit(evidence.candidate.preferenceScore) ?? 0,
    distanceKm: finiteNonNegative(evidence.candidate.distanceKm),
    travelTimeMinutes: finiteNonNegative(evidence.candidate.travelTimeMinutes),
    concentration: evidence.tourism.concentration,
    dispersion: evidence.tourism.dispersion,
    localImpact: evidence.localImpact.score,
    tourism: evidence.tourism,
    localImpactEvidence: evidence.localImpact,
    fallbackToBaseline,
  };
}

function rankCandidates(
  candidates: Array<{ evaluated: EvaluatedCandidate; originalIndex: number }>,
): EvaluatedCandidate[] {
  return candidates
    .sort(
      (left, right) =>
        right.evaluated.algorithmScore - left.evaluated.algorithmScore ||
        left.originalIndex - right.originalIndex ||
        left.evaluated.id.localeCompare(right.evaluated.id),
    )
    .map(({ evaluated }, index) => ({ ...evaluated, rank: index + 1 }));
}

function average(values: ReadonlyArray<number | null>): number | null {
  const available = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (available.length === 0) return null;
  return Number((available.reduce((sum, value) => sum + value, 0) / available.length).toFixed(6));
}

function metricsFor(
  selected: ReadonlyArray<EvaluatedCandidate>,
  nonHotspotThreshold: number,
): EvaluationMetrics {
  const concentrationValues = selected
    .map((candidate) => candidate.concentration)
    .filter((value): value is number => value !== null);
  return {
    averagePreferenceScore: average(selected.map((candidate) => candidate.preferenceScore)),
    tourismConcentrationScore: average(concentrationValues),
    nonHotspotInclusionRate:
      concentrationValues.length === 0
        ? null
        : Number(
            (
              concentrationValues.filter((value) => value <= nonHotspotThreshold).length /
              concentrationValues.length
            ).toFixed(6),
          ),
    averageTravelDistanceKm: average(selected.map((candidate) => candidate.distanceKm)),
    averageTravelTimeMinutes: average(selected.map((candidate) => candidate.travelTimeMinutes)),
    localImpactScore: average(selected.map((candidate) => candidate.localImpact)),
  };
}

function delta(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null;
  return Number((left - right).toFixed(6));
}

function evaluationDelta(michi: EvaluationMetrics, baseline: EvaluationMetrics): EvaluationDelta {
  return {
    averagePreferenceScore: delta(michi.averagePreferenceScore, baseline.averagePreferenceScore),
    tourismConcentrationScore: delta(
      michi.tourismConcentrationScore,
      baseline.tourismConcentrationScore,
    ),
    nonHotspotInclusionRate: delta(michi.nonHotspotInclusionRate, baseline.nonHotspotInclusionRate),
    averageTravelDistanceKm: delta(michi.averageTravelDistanceKm, baseline.averageTravelDistanceKm),
    averageTravelTimeMinutes: delta(
      michi.averageTravelTimeMinutes,
      baseline.averageTravelTimeMinutes,
    ),
    localImpactScore: delta(michi.localImpactScore, baseline.localImpactScore),
  };
}

export function evaluateBaselineAndMichi(
  input: RecommendationEvaluationInput,
): RecommendationEvaluationReport {
  const preferenceThreshold = input.preferenceThreshold ?? DEFAULT_PREFERENCE_THRESHOLD;
  const nonHotspotThreshold = input.nonHotspotThreshold ?? 0.5;
  const requestedLimit = input.limit ?? input.candidates.length;
  const limit = Math.max(0, Math.min(input.candidates.length, Math.floor(requestedLimit)));
  const evidence = input.candidates.map((candidate, index) =>
    evidenceFor(candidate, index, preferenceThreshold),
  );

  const baselineRanked = rankCandidates(
    evidence.map((entry) => ({
      evaluated: evaluatedCandidate(entry, entry.baselineQualityScore, false),
      originalIndex: entry.originalIndex,
    })),
  );

  const michiRanked = rankCandidates(
    evidence
      .filter(
        (entry) =>
          Number.isFinite(entry.candidate.preferenceScore) &&
          entry.candidate.preferenceScore >= preferenceThreshold,
      )
      .map((entry) => {
        const fallbackToBaseline =
          entry.tourism.dispersion === null && entry.localImpact.score === null;
        const michiScore = fallbackToBaseline
          ? entry.baselineQualityScore
          : (weightedAvailableScore(
              {
                baselineQuality: entry.baselineQualityScore,
                tourismDispersion: entry.tourism.dispersion,
                localImpact: entry.localImpact.score,
              },
              MICHI_WEIGHTS,
            ).score ?? entry.baselineQualityScore);
        return {
          evaluated: evaluatedCandidate(entry, michiScore, fallbackToBaseline),
          originalIndex: entry.originalIndex,
        };
      }),
  );

  const baselineSelected = baselineRanked.slice(0, limit);
  const michiSelected = michiRanked.slice(0, limit);
  const baselineMetrics = metricsFor(baselineSelected, nonHotspotThreshold);
  const michiMetrics = metricsFor(michiSelected, nonHotspotThreshold);

  return {
    algorithmVersion: EVALUATION_ALGORITHM_VERSION,
    inputCandidateIds: input.candidates.map((candidate) => candidate.id),
    preferenceThreshold,
    nonHotspotThreshold,
    baseline: {
      algorithmVersion: BASELINE_ALGORITHM_VERSION,
      ranked: baselineRanked,
      selected: baselineSelected,
      metrics: baselineMetrics,
    },
    michi: {
      algorithmVersion: MICHI_ALGORITHM_VERSION,
      ranked: michiRanked,
      selected: michiSelected,
      metrics: michiMetrics,
    },
    delta: evaluationDelta(michiMetrics, baselineMetrics),
    expectedEffect: calculateExpectedDispersionEffect(baselineMetrics, michiMetrics),
  };
}
