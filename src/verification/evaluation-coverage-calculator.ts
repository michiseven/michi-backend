export type DeterminismStatus = 'pass' | 'fail' | 'not_checked';
export type EvidenceStatus = 'available' | 'partial' | 'unavailable';

export interface LatestImportSummary {
  importRunId: string | null;
  referencePeriod: string | null;
  completedAt: string | null;
  mode: 'live' | 'mock' | 'unavailable';
  totalKtoPlaces: number;
  ktoPlacesWithConcentration: number;
  ktoPlaceCoverageRatio: number;
  metricRows: number | null;
}

export interface MatchingDiagnostics {
  status: 'available' | 'unavailable';
  districts: number | null;
  pages: number | null;
  fetched: number | null;
  rejectedByProvider: number | null;
  matchedRows: number | null;
  matchedPlaces: number | null;
  unmatchedAttractions: number | null;
  ambiguousAttractions: number | null;
  matchingPolicyVersion: string | null;
  unavailableReason?: string | null;
}

export interface ImportRunCandidate {
  id: string;
  sourceId: string;
  referencePeriod: string | null;
  mode: string;
  status: string;
  metadata?: Record<string, unknown> | null;
  completedAt: Date | null;
  startedAt?: Date | null;
}

export interface TourismMetricCandidate {
  importRunId: string;
  placeId: string | null;
}

export interface ScenarioRunComparable {
  baselineStops: readonly string[];
  michiStops: readonly string[];
  evidenceStatus: EvidenceStatus;
  delta: Record<string, number | null>;
  controlledBaselineStops?: readonly string[];
  controlledMichiStops?: readonly string[];
  controlledDelta?: Record<string, number | null>;
}

export interface ScenarioCoverageItem {
  totalCandidates: number;
  candidatesWithConcentration: number;
  candidateCoverageRatio: number;
  baselineSelectedCount: number;
  baselineSelectedWithConcentration: number;
  baselineCoverageRatio: number;
  michiSelectedCount: number;
  michiSelectedWithConcentration: number;
  michiCoverageRatio: number;
  evidenceStatus: EvidenceStatus;
}

export interface OverallCoverageSummary {
  totalCandidates: number;
  candidatesWithConcentration: number;
  candidateCoverageRatio: number;
  totalBaselineSelected: number;
  baselineSelectedWithConcentration: number;
  baselineCoverageRatio: number;
  totalMichiSelected: number;
  michiSelectedWithConcentration: number;
  michiCoverageRatio: number;
  evidenceStatusCounts: {
    available: number;
    partial: number;
    unavailable: number;
  };
  evidenceStatusRatios: {
    available: number;
    partial: number;
    unavailable: number;
  };
}

export function calculateCoverageRatio(count: number, total: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0 || count <= 0) {
    return 0;
  }
  return Number((Math.min(count, total) / total).toFixed(4));
}

export function findLatestCompletedImportRun(
  runs: readonly ImportRunCandidate[],
): ImportRunCandidate | null {
  const completed = runs.filter((r) => r.status === 'completed');
  if (completed.length === 0) return null;
  return (
    [...completed].sort((a, b) => {
      const timeA = a.completedAt?.getTime() ?? a.startedAt?.getTime() ?? 0;
      const timeB = b.completedAt?.getTime() ?? b.startedAt?.getTime() ?? 0;
      return timeB - timeA;
    })[0] ?? null
  );
}

export function parseImportRunMatchingDiagnostics(
  metadata: Record<string, unknown> | null | undefined,
): MatchingDiagnostics {
  if (!metadata || typeof metadata !== 'object') {
    return {
      status: 'unavailable',
      districts: null,
      pages: null,
      fetched: null,
      rejectedByProvider: null,
      matchedRows: null,
      matchedPlaces: null,
      unmatchedAttractions: null,
      ambiguousAttractions: null,
      matchingPolicyVersion: null,
      unavailableReason: 'ImportRun metadata가 없거나 비어 있습니다.',
    };
  }

  const hasMatchingStats =
    'matchedRows' in metadata &&
    'matchedPlaces' in metadata &&
    'unmatchedAttractions' in metadata &&
    'ambiguousAttractions' in metadata;

  if (!hasMatchingStats) {
    return {
      status: 'unavailable',
      districts: null,
      pages: null,
      fetched: null,
      rejectedByProvider: null,
      matchedRows: null,
      matchedPlaces: null,
      unmatchedAttractions: null,
      ambiguousAttractions: null,
      matchingPolicyVersion:
        typeof metadata.matchingPolicyVersion === 'string' ? metadata.matchingPolicyVersion : null,
      unavailableReason: '해당 ImportRun에 매칭 진단 통계가 기록되지 않았습니다.',
    };
  }

  const parseNumberOrNull = (val: unknown): number | null =>
    typeof val === 'number' && Number.isFinite(val) ? val : null;

  return {
    status: 'available',
    districts: parseNumberOrNull(metadata.districts),
    pages: parseNumberOrNull(metadata.pages),
    fetched: parseNumberOrNull(metadata.fetched),
    rejectedByProvider: parseNumberOrNull(metadata.rejectedByProvider),
    matchedRows: parseNumberOrNull(metadata.matchedRows),
    matchedPlaces: parseNumberOrNull(metadata.matchedPlaces),
    unmatchedAttractions: parseNumberOrNull(metadata.unmatchedAttractions),
    ambiguousAttractions: parseNumberOrNull(metadata.ambiguousAttractions),
    matchingPolicyVersion:
      typeof metadata.matchingPolicyVersion === 'string' ? metadata.matchingPolicyVersion : null,
    unavailableReason: null,
  };
}

export function computeImportRunMetricsScope(
  latestRun: ImportRunCandidate | null,
  allMetrics: readonly TourismMetricCandidate[],
  totalKtoPlaces: number,
): {
  latestImport: LatestImportSummary;
  matching: MatchingDiagnostics;
  warnings: string[];
} {
  if (!latestRun) {
    return {
      latestImport: {
        importRunId: null,
        referencePeriod: null,
        completedAt: null,
        mode: 'unavailable',
        totalKtoPlaces,
        ktoPlacesWithConcentration: 0,
        ktoPlaceCoverageRatio: 0,
        metricRows: null,
      },
      matching: {
        status: 'unavailable',
        districts: null,
        pages: null,
        fetched: null,
        rejectedByProvider: null,
        matchedRows: null,
        matchedPlaces: null,
        unmatchedAttractions: null,
        ambiguousAttractions: null,
        matchingPolicyVersion: null,
        unavailableReason: '완료된 DataLab ImportRun이 존재하지 않습니다.',
      },
      warnings: ['KTO DataLab 관광 집중률 예측의 완료된 ImportRun이 없습니다.'],
    };
  }

  const scopedMetrics = allMetrics.filter((m) => m.importRunId === latestRun.id);
  const uniquePlaceIds = new Set(
    scopedMetrics.map((m) => m.placeId).filter((id): id is string => Boolean(id)),
  );
  const ktoPlacesWithConcentration = uniquePlaceIds.size;
  const ktoPlaceCoverageRatio = calculateCoverageRatio(ktoPlacesWithConcentration, totalKtoPlaces);

  const matching = parseImportRunMatchingDiagnostics(latestRun.metadata);
  const warnings: string[] = [];
  if (matching.status === 'unavailable' && matching.unavailableReason) {
    warnings.push(matching.unavailableReason);
  }

  const mode =
    latestRun.mode === 'live' || latestRun.mode === 'mock' ? latestRun.mode : 'unavailable';

  return {
    latestImport: {
      importRunId: latestRun.id,
      referencePeriod: latestRun.referencePeriod,
      completedAt: latestRun.completedAt?.toISOString() ?? null,
      mode,
      totalKtoPlaces,
      ktoPlacesWithConcentration,
      ktoPlaceCoverageRatio,
      metricRows: scopedMetrics.length,
    },
    matching,
    warnings,
  };
}

export function checkRunsDeterminism(runs: readonly ScenarioRunComparable[]): {
  determinismStatus: DeterminismStatus;
  isDeterministic: boolean;
} {
  if (runs.length <= 1) {
    return { determinismStatus: 'not_checked', isDeterministic: true };
  }

  const first = runs[0]!;
  const firstBaseline = first.baselineStops.join('|');
  const firstMichi = first.michiStops.join('|');
  const firstEvidence = first.evidenceStatus;
  const firstDelta = JSON.stringify(first.delta);
  const firstControlledBaseline = (first.controlledBaselineStops ?? []).join('|');
  const firstControlledMichi = (first.controlledMichiStops ?? []).join('|');
  const firstControlledDelta = JSON.stringify(first.controlledDelta ?? {});

  for (let i = 1; i < runs.length; i++) {
    const curr = runs[i]!;
    const currBaseline = curr.baselineStops.join('|');
    const currMichi = curr.michiStops.join('|');
    const currEvidence = curr.evidenceStatus;
    const currDelta = JSON.stringify(curr.delta);
    const currControlledBaseline = (curr.controlledBaselineStops ?? []).join('|');
    const currControlledMichi = (curr.controlledMichiStops ?? []).join('|');
    const currControlledDelta = JSON.stringify(curr.controlledDelta ?? {});

    if (
      currBaseline !== firstBaseline ||
      currMichi !== firstMichi ||
      currEvidence !== firstEvidence ||
      currDelta !== firstDelta ||
      currControlledBaseline !== firstControlledBaseline ||
      currControlledMichi !== firstControlledMichi ||
      currControlledDelta !== firstControlledDelta
    ) {
      return { determinismStatus: 'fail', isDeterministic: false };
    }
  }

  return { determinismStatus: 'pass', isDeterministic: true };
}

export function aggregateCoverage(items: readonly ScenarioCoverageItem[]): OverallCoverageSummary {
  const totalCandidates = items.reduce((sum, s) => sum + s.totalCandidates, 0);
  const candidatesWithConcentration = items.reduce(
    (sum, s) => sum + s.candidatesWithConcentration,
    0,
  );
  const candidateCoverageRatio = calculateCoverageRatio(
    candidatesWithConcentration,
    totalCandidates,
  );

  const totalBaselineSelected = items.reduce((sum, s) => sum + s.baselineSelectedCount, 0);
  const baselineSelectedWithConcentration = items.reduce(
    (sum, s) => sum + s.baselineSelectedWithConcentration,
    0,
  );
  const baselineCoverageRatio = calculateCoverageRatio(
    baselineSelectedWithConcentration,
    totalBaselineSelected,
  );

  const totalMichiSelected = items.reduce((sum, s) => sum + s.michiSelectedCount, 0);
  const michiSelectedWithConcentration = items.reduce(
    (sum, s) => sum + s.michiSelectedWithConcentration,
    0,
  );
  const michiCoverageRatio = calculateCoverageRatio(
    michiSelectedWithConcentration,
    totalMichiSelected,
  );

  const evidenceStatusCounts = {
    available: items.filter((s) => s.evidenceStatus === 'available').length,
    partial: items.filter((s) => s.evidenceStatus === 'partial').length,
    unavailable: items.filter((s) => s.evidenceStatus === 'unavailable').length,
  };

  const totalScenarios = items.length;
  const evidenceStatusRatios = {
    available: calculateCoverageRatio(evidenceStatusCounts.available, totalScenarios),
    partial: calculateCoverageRatio(evidenceStatusCounts.partial, totalScenarios),
    unavailable: calculateCoverageRatio(evidenceStatusCounts.unavailable, totalScenarios),
  };

  return {
    totalCandidates,
    candidatesWithConcentration,
    candidateCoverageRatio,
    totalBaselineSelected,
    baselineSelectedWithConcentration,
    baselineCoverageRatio,
    totalMichiSelected,
    michiSelectedWithConcentration,
    michiCoverageRatio,
    evidenceStatusCounts,
    evidenceStatusRatios,
  };
}

export function determineOverallDataMode(modes: readonly string[]): 'live' | 'mock' | 'mixed' {
  if (modes.length === 0) return 'mock';
  if (modes.some((m) => m === 'mixed')) return 'mixed';
  if (modes.every((m) => m === 'live')) return 'live';
  if (modes.every((m) => m === 'mock')) return 'mock';
  return 'mixed';
}

export function formatShortId(id: string | null): string {
  if (!id) return 'N/A';
  return id.length > 8 ? id.slice(0, 8) : id;
}
