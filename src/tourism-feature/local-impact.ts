import { weightedAvailableScore } from './score-utils';

export const LOCAL_IMPACT_ALGORITHM_VERSION = 'local-impact-v1';
export const DEFAULT_PREFERENCE_THRESHOLD = 0.6;

export const LOCAL_IMPACT_WEIGHTS = Object.freeze({
  dispersion: 0.5,
  alternativeSimilarity: 0.3,
  tourismFlow: 0.2,
});

export type LocalImpactFeature = keyof typeof LOCAL_IMPACT_WEIGHTS;

export interface LocalImpactInput {
  preferenceScore: number;
  dispersion: number | null;
  alternativeSimilarity: number | null;
  tourismFlow: number | null;
  preferenceThreshold?: number;
}

export interface LocalImpactResult {
  algorithmVersion: string;
  eligible: boolean;
  score: number | null;
  effectiveWeights: Partial<Record<LocalImpactFeature, number>>;
}

export function calculateLocalImpact(input: LocalImpactInput): LocalImpactResult {
  const threshold = input.preferenceThreshold ?? DEFAULT_PREFERENCE_THRESHOLD;
  const eligible = Number.isFinite(input.preferenceScore) && input.preferenceScore >= threshold;
  if (!eligible) {
    return {
      algorithmVersion: LOCAL_IMPACT_ALGORITHM_VERSION,
      eligible: false,
      score: null,
      effectiveWeights: {},
    };
  }

  const result = weightedAvailableScore<LocalImpactFeature>(
    {
      dispersion: input.dispersion,
      alternativeSimilarity: input.alternativeSimilarity,
      tourismFlow: input.tourismFlow,
    },
    LOCAL_IMPACT_WEIGHTS,
  );
  return {
    algorithmVersion: LOCAL_IMPACT_ALGORITHM_VERSION,
    eligible: true,
    score: result.score,
    effectiveWeights: result.effectiveWeights,
  };
}
