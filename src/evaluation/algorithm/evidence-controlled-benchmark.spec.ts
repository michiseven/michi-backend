import type { EvaluationCandidateInput } from './recommendation-evaluator';
import { evaluateEvidenceControlledBenchmark } from './evidence-controlled-benchmark';

function candidate(
  id: string,
  preferenceScore: number,
  concentration: number | null,
): EvaluationCandidateInput {
  return {
    id,
    preferenceScore,
    popularityScore: concentration,
    distanceScore: 0.8,
    timeScore: 0.8,
    distanceKm: 1,
    travelTimeMinutes: 15,
    tourismResult: {
      algorithmVersion: 'tourism-concentration-percentile-v1',
      concentration,
      dispersion: concentration === null ? null : 1 - concentration,
      features: {},
    },
    alternativeSimilarity: concentration === null ? null : preferenceScore,
    tourismFlow: null,
  };
}

describe('Evidence-Controlled Benchmark', () => {
  it('uses one identical pool with measured concentration and acceptable preference', () => {
    const candidates = [
      candidate('hotspot', 0.9, 0.9),
      candidate('measured-local', 0.85, 0.2),
      candidate('unknown', 0.95, null),
      candidate('below-preference', 0.4, 0.1),
    ];
    const before = structuredClone(candidates);

    const benchmark = evaluateEvidenceControlledBenchmark({
      candidates,
      limit: 2,
      preferenceThreshold: 0.6,
    });

    expect(benchmark.status).toBe('available');
    expect(benchmark.candidatePool).toEqual({
      totalCandidates: 4,
      candidatesWithConcentration: 3,
      excludedMissingConcentration: 1,
      excludedBelowPreferenceThreshold: 1,
      eligibleCandidates: 2,
      requestedSelectionCount: 2,
      evaluatedSelectionCount: 2,
    });
    expect(benchmark.evaluation.inputCandidateIds).toEqual(['hotspot', 'measured-local']);
    expect(benchmark.evaluation.baseline.ranked.map(({ id }) => id).sort()).toEqual(
      benchmark.evaluation.michi.ranked.map(({ id }) => id).sort(),
    );
    expect(
      benchmark.evaluation.baseline.selected.every(({ concentration }) => concentration !== null),
    ).toBe(true);
    expect(
      benchmark.evaluation.michi.selected.every(({ concentration }) => concentration !== null),
    ).toBe(true);
    expect(candidates).toEqual(before);
  });

  it('reports partial when evidence candidates cannot fill the requested selection', () => {
    const benchmark = evaluateEvidenceControlledBenchmark({
      candidates: [candidate('measured', 0.8, 0.4), candidate('unknown', 0.9, null)],
      limit: 3,
      preferenceThreshold: 0.6,
    });

    expect(benchmark.status).toBe('partial');
    expect(benchmark.candidatePool.evaluatedSelectionCount).toBe(1);
    expect(benchmark.evaluation.baseline.selected).toHaveLength(1);
    expect(benchmark.evaluation.michi.selected).toHaveLength(1);
    expect(benchmark.evaluation.expectedEffect.evidenceStatus).toBe('available');
  });

  it('reports unavailable and does not convert missing evidence to zero', () => {
    const benchmark = evaluateEvidenceControlledBenchmark({
      candidates: [candidate('unknown-a', 0.9, null), candidate('unknown-b', 0.8, null)],
      limit: 2,
    });

    expect(benchmark.status).toBe('unavailable');
    expect(benchmark.candidatePool.candidatesWithConcentration).toBe(0);
    expect(benchmark.candidatePool.eligibleCandidates).toBe(0);
    expect(benchmark.evaluation.baseline.selected).toEqual([]);
    expect(benchmark.evaluation.michi.selected).toEqual([]);
    expect(benchmark.evaluation.expectedEffect).toMatchObject({
      evidenceStatus: 'unavailable',
      concentrationReduction: null,
      nonHotspotInclusionLift: null,
    });
  });

  it('reports unavailable when every measured candidate fails the preference gate', () => {
    const benchmark = evaluateEvidenceControlledBenchmark({
      candidates: [candidate('measured-but-irrelevant', 0.3, 0.1)],
      limit: 1,
      preferenceThreshold: 0.6,
    });

    expect(benchmark.status).toBe('unavailable');
    expect(benchmark.candidatePool.candidatesWithConcentration).toBe(1);
    expect(benchmark.candidatePool.excludedBelowPreferenceThreshold).toBe(1);
    expect(benchmark.candidatePool.eligibleCandidates).toBe(0);
  });
});
