import { DEFAULT_PREFERENCE_THRESHOLD } from '../../tourism-feature/local-impact';
import { calculateTourismConcentration } from '../../tourism-feature/tourism-concentration';
import {
  evaluateBaselineAndMichi,
  type EvaluationCandidateInput,
  type RecommendationEvaluationInput,
  type RecommendationEvaluationReport,
} from './recommendation-evaluator';

export const EVIDENCE_CONTROLLED_BENCHMARK_VERSION = 'evidence-controlled-benchmark-v1';

export type EvidenceControlledBenchmarkStatus = 'available' | 'partial' | 'unavailable';

export interface EvidenceControlledCandidatePool {
  totalCandidates: number;
  candidatesWithConcentration: number;
  excludedMissingConcentration: number;
  excludedBelowPreferenceThreshold: number;
  eligibleCandidates: number;
  requestedSelectionCount: number;
  evaluatedSelectionCount: number;
}

export interface EvidenceControlledBenchmarkReport {
  algorithmVersion: string;
  status: EvidenceControlledBenchmarkStatus;
  candidatePool: EvidenceControlledCandidatePool;
  evaluation: RecommendationEvaluationReport;
}

function concentrationOf(candidate: EvaluationCandidateInput): number | null {
  const result =
    candidate.tourismResult ?? calculateTourismConcentration(candidate.tourismFeatures ?? {});
  return result.concentration;
}

/**
 * Compares Baseline and Michi on one identical, measurable candidate pool.
 * Candidates without a measured tourism concentration are excluded rather than
 * being treated as low-concentration alternatives.
 */
export function evaluateEvidenceControlledBenchmark(
  input: RecommendationEvaluationInput,
): EvidenceControlledBenchmarkReport {
  const preferenceThreshold = input.preferenceThreshold ?? DEFAULT_PREFERENCE_THRESHOLD;
  const requestedSelectionCount = Math.max(0, Math.floor(input.limit ?? input.candidates.length));
  const withConcentration = input.candidates.filter(
    (candidate) => concentrationOf(candidate) !== null,
  );
  const eligible = withConcentration.filter(
    (candidate) =>
      Number.isFinite(candidate.preferenceScore) &&
      candidate.preferenceScore >= preferenceThreshold,
  );
  const evaluatedSelectionCount = Math.min(requestedSelectionCount, eligible.length);
  const status: EvidenceControlledBenchmarkStatus =
    eligible.length === 0 || requestedSelectionCount === 0
      ? 'unavailable'
      : eligible.length >= requestedSelectionCount
        ? 'available'
        : 'partial';

  return {
    algorithmVersion: EVIDENCE_CONTROLLED_BENCHMARK_VERSION,
    status,
    candidatePool: {
      totalCandidates: input.candidates.length,
      candidatesWithConcentration: withConcentration.length,
      excludedMissingConcentration: input.candidates.length - withConcentration.length,
      excludedBelowPreferenceThreshold: withConcentration.length - eligible.length,
      eligibleCandidates: eligible.length,
      requestedSelectionCount,
      evaluatedSelectionCount,
    },
    evaluation: evaluateBaselineAndMichi({
      ...input,
      candidates: eligible,
      limit: evaluatedSelectionCount,
      preferenceThreshold,
    }),
  };
}
