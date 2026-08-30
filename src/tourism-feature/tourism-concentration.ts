import { roundScore, weightedAvailableScore } from './score-utils';

export const TOURISM_CONCENTRATION_ALGORITHM_VERSION = 'tourism-concentration-percentile-v1';

export const TOURISM_CONCENTRATION_WEIGHTS = Object.freeze({
  visitor_count: 0.35,
  concentration_forecast_index: 0.3,
  navigation_search_count: 0.2,
  tourism_consumption_amount: 0.15,
});

export type TourismConcentrationFeature = keyof typeof TOURISM_CONCENTRATION_WEIGHTS;

export interface PeerObservedValue {
  value: number | null;
  peerValues: ReadonlyArray<number | null>;
}

export type TourismConcentrationInput = Partial<
  Record<TourismConcentrationFeature, PeerObservedValue>
>;

export interface NormalizedTourismFeature {
  observedValue: number;
  percentile: number;
  effectiveWeight: number;
  peerCount: number;
}

export interface TourismConcentrationResult {
  algorithmVersion: string;
  /** Raw concentration direction: a larger value means relatively more concentrated. */
  concentration: number | null;
  /** Recommendation direction: a larger value means more suitable for demand dispersion. */
  dispersion: number | null;
  features: Partial<Record<TourismConcentrationFeature, NormalizedTourismFeature>>;
}

/**
 * Midrank percentile over actual peer observations. Ties receive half credit so the result is
 * deterministic without inventing a distribution. Missing/non-finite observations are unavailable.
 */
export function percentileRank(
  observedValue: number | null | undefined,
  peerValues: ReadonlyArray<number | null>,
): number | null {
  if (typeof observedValue !== 'number' || !Number.isFinite(observedValue)) return null;
  const peers = peerValues.filter(
    (candidate): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate),
  );
  if (peers.length === 0) return null;
  const lower = peers.filter((candidate) => candidate < observedValue).length;
  const equal = peers.filter((candidate) => candidate === observedValue).length;
  return roundScore((lower + equal * 0.5) / peers.length);
}

export function calculateTourismConcentration(
  input: TourismConcentrationInput,
): TourismConcentrationResult {
  const percentiles: Partial<Record<TourismConcentrationFeature, number | null>> = {};
  const peerCounts: Partial<Record<TourismConcentrationFeature, number>> = {};

  for (const feature of Object.keys(
    TOURISM_CONCENTRATION_WEIGHTS,
  ) as TourismConcentrationFeature[]) {
    const observation = input[feature];
    if (!observation) {
      percentiles[feature] = null;
      continue;
    }
    percentiles[feature] = percentileRank(observation.value, observation.peerValues);
    peerCounts[feature] = observation.peerValues.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    ).length;
  }

  const normalized = weightedAvailableScore(percentiles, TOURISM_CONCENTRATION_WEIGHTS);
  const features: Partial<Record<TourismConcentrationFeature, NormalizedTourismFeature>> = {};
  for (const feature of Object.keys(
    TOURISM_CONCENTRATION_WEIGHTS,
  ) as TourismConcentrationFeature[]) {
    const observation = input[feature];
    const percentile = percentiles[feature];
    const effectiveWeight = normalized.effectiveWeights[feature];
    if (
      !observation ||
      observation.value === null ||
      percentile === null ||
      percentile === undefined ||
      effectiveWeight === undefined
    ) {
      continue;
    }
    features[feature] = {
      observedValue: observation.value,
      percentile,
      effectiveWeight,
      peerCount: peerCounts[feature] ?? 0,
    };
  }

  return {
    algorithmVersion: TOURISM_CONCENTRATION_ALGORITHM_VERSION,
    concentration: normalized.score,
    dispersion: normalized.score === null ? null : roundScore(1 - normalized.score),
    features,
  };
}
