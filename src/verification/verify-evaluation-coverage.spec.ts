import {
  extractParenthesisBlocks,
  comparable,
  ktoPlaceNameAliases,
  datalabAttractionAliases,
  uniqueKtoPlaceMatch,
} from '../tourism-data/kto-datalab-concentration-sync.service';
import {
  calculateCoverageRatio,
  findLatestCompletedImportRun,
  parseImportRunMatchingDiagnostics,
  computeImportRunMetricsScope,
  checkRunsDeterminism,
  aggregateCoverage,
  determineOverallDataMode,
  formatShortId,
  type ImportRunCandidate,
  type TourismMetricCandidate,
  type ScenarioRunComparable,
  type ScenarioCoverageItem,
} from './evaluation-coverage-calculator';
import type { Place } from '../database/entities';

describe('verify-evaluation-coverage helper and matching rules', () => {
  describe('Parenthesis & String Normalization', () => {
    it('extracts balanced brackets properly without throwing', () => {
      expect(extractParenthesisBlocks('東大門（DDP）（동대문디자인플라자（DDP））')).toEqual([
        'DDP',
        '동대문디자인플라자（DDP）',
      ]);
      expect(extractParenthesisBlocks('서울 선릉과정릉 [유네스코 세계유산]')).toEqual([
        '유네스코 세계유산',
      ]);
    });

    it('normalizes Unicode NFKC, decodes HTML entities, and strips punctuation', () => {
      expect(comparable('<b>성수</b> &quot;카페&quot; 거리')).toBe('성수카페거리');
      expect(comparable('AK PLAZA   홍대!')).toBe('akplaza홍대');
      expect(comparable('100주년&#39;기념관')).toBe('100주년기념관');
    });

    it('generates consistent deterministic aliases for KTO and DataLab attractions', () => {
      const ktoAliases = ktoPlaceNameAliases('AK PLAZA弘大（AK PLAZA 홍대）');
      expect(ktoAliases).toContain('akplaza홍대');

      const datalabAliases = datalabAttractionAliases('우표박물관 (구.우표문화누리)');
      expect(datalabAliases).toContain('우표박물관');
    });
  });

  describe('KTO / DataLab Matching Integrity', () => {
    it('returns place when unique match exists across aliases', () => {
      const mockPlace = { id: 'place-1', name: '남산골한옥마을' } as Place;
      const map = new Map<string, readonly Place[]>([['남산골한옥마을', [mockPlace]]]);

      const result = uniqueKtoPlaceMatch('남산골한옥마을 (서울)', map);
      expect(result).toBe(mockPlace);
    });

    it('returns ambiguous and forbids arbitrary selection when multiple distinct places match', () => {
      const placeA = { id: 'place-a', name: '현대백화점 신촌점' } as Place;
      const placeB = { id: 'place-b', name: '현대백화점 목동점' } as Place;
      const map = new Map<string, readonly Place[]>([['현대백화점', [placeA, placeB]]]);

      const result = uniqueKtoPlaceMatch('현대백화점', map);
      expect(result).toBe('ambiguous');
    });

    it('returns null when no alias matches', () => {
      const map = new Map<string, readonly Place[]>();
      const result = uniqueKtoPlaceMatch('전혀없는관광지', map);
      expect(result).toBeNull();
    });

    it('handles multiple aliases pointing to the same place without flagging ambiguous', () => {
      const place = { id: 'place-1', name: 'AK PLAZA 홍대' } as Place;
      const map = new Map<string, readonly Place[]>([
        ['akplaza홍대', [place]],
        ['akplaza', [place]],
      ]);

      const result = uniqueKtoPlaceMatch('AK PLAZA 홍대', map);
      expect(result).toBe(place);
    });
  });

  describe('Coverage Ratio Calculation', () => {
    it('calculates 4-decimal coverage ratio correctly', () => {
      expect(calculateCoverageRatio(146, 683)).toBe(0.2138);
      expect(calculateCoverageRatio(5, 50)).toBe(0.1);
      expect(calculateCoverageRatio(0, 50)).toBe(0);
    });

    it('handles edge cases where denominator is 0 or invalid without NaN/Infinity', () => {
      expect(calculateCoverageRatio(0, 0)).toBe(0);
      expect(calculateCoverageRatio(5, 0)).toBe(0);
      expect(calculateCoverageRatio(-1, 10)).toBe(0);
      expect(calculateCoverageRatio(10, -5)).toBe(0);
      expect(calculateCoverageRatio(NaN, 10)).toBe(0);
    });

    it('caps ratio at 1.0 when count exceeds total', () => {
      expect(calculateCoverageRatio(15, 10)).toBe(1.0);
    });
  });

  describe('Latest ImportRun Selection & Metrics Scoping', () => {
    const olderRun: ImportRunCandidate = {
      id: 'run-older',
      sourceId: 'source-1',
      referencePeriod: '2026-08-01~2026-08-31',
      mode: 'live',
      status: 'completed',
      metadata: {
        matchedRows: 3288,
        matchedPlaces: 137,
        unmatchedAttractions: 500,
        ambiguousAttractions: 2,
        matchingPolicyVersion: 'v1',
      },
      completedAt: new Date('2026-08-01T10:00:00Z'),
      startedAt: new Date('2026-08-01T09:00:00Z'),
    };

    const latestCompletedRun: ImportRunCandidate = {
      id: 'run-latest',
      sourceId: 'source-1',
      referencePeriod: '2026-08-26~2026-09-24',
      mode: 'live',
      status: 'completed',
      metadata: {
        districts: 25,
        pages: 25,
        fetched: 20250,
        rejectedByProvider: 0,
        matchedRows: 4380,
        matchedPlaces: 146,
        unmatchedAttractions: 528,
        ambiguousAttractions: 1,
        matchingPolicyVersion: 'kto-datalab-matching-v2-paren-alias',
      },
      completedAt: new Date('2026-08-26T11:43:56Z'),
      startedAt: new Date('2026-08-26T11:40:00Z'),
    };

    const failedRun: ImportRunCandidate = {
      id: 'run-failed',
      sourceId: 'source-1',
      referencePeriod: '2026-08-27~2026-09-25',
      mode: 'live',
      status: 'failed',
      completedAt: new Date('2026-08-27T10:00:00Z'),
    };

    const processingRun: ImportRunCandidate = {
      id: 'run-processing',
      sourceId: 'source-1',
      referencePeriod: '2026-08-27~2026-09-25',
      mode: 'live',
      status: 'processing',
      completedAt: null,
      startedAt: new Date('2026-08-27T10:05:00Z'),
    };

    it('selects latest completed ImportRun and ignores failed or processing runs', () => {
      const runs = [olderRun, processingRun, latestCompletedRun, failedRun];
      const selected = findLatestCompletedImportRun(runs);
      expect(selected).toBe(latestCompletedRun);
    });

    it('returns null if no completed runs exist', () => {
      const runs = [failedRun, processingRun];
      expect(findLatestCompletedImportRun(runs)).toBeNull();
    });

    it('scopes metrics strictly to the selected latest ImportRun without mixing historical rows', () => {
      const allMetrics: TourismMetricCandidate[] = [
        { importRunId: 'run-older', placeId: 'place-old-1' },
        { importRunId: 'run-older', placeId: 'place-old-2' },
        { importRunId: 'run-latest', placeId: 'place-new-1' },
        { importRunId: 'run-latest', placeId: 'place-new-2' },
        { importRunId: 'run-latest', placeId: 'place-new-1' }, // duplicate row for same place
      ];

      const { latestImport, matching } = computeImportRunMetricsScope(
        latestCompletedRun,
        allMetrics,
        683,
      );

      expect(latestImport.importRunId).toBe('run-latest');
      expect(latestImport.metricRows).toBe(3); // only run-latest rows
      expect(latestImport.ktoPlacesWithConcentration).toBe(2); // unique place-new-1 and place-new-2
      expect(latestImport.ktoPlaceCoverageRatio).toBe(calculateCoverageRatio(2, 683));
      expect(matching.status).toBe('available');
      expect(matching.matchedPlaces).toBe(146);
      expect(matching.unmatchedAttractions).toBe(528);
      expect(matching.ambiguousAttractions).toBe(1);
    });

    it('returns unavailable status with clear warning when no latest run is provided', () => {
      const { latestImport, matching, warnings } = computeImportRunMetricsScope(null, [], 683);

      expect(latestImport.mode).toBe('unavailable');
      expect(latestImport.metricRows).toBeNull();
      expect(matching.status).toBe('unavailable');
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe('ImportRun Matching Metadata Parsing', () => {
    it('parses valid matching metadata correctly', () => {
      const meta = {
        districts: 25,
        pages: 25,
        fetched: 20250,
        rejectedByProvider: 0,
        matchedRows: 4380,
        matchedPlaces: 146,
        unmatchedAttractions: 528,
        ambiguousAttractions: 1,
        matchingPolicyVersion: 'v2',
      };
      const result = parseImportRunMatchingDiagnostics(meta);
      expect(result.status).toBe('available');
      expect(result.matchedRows).toBe(4380);
      expect(result.matchedPlaces).toBe(146);
      expect(result.unmatchedAttractions).toBe(528);
      expect(result.ambiguousAttractions).toBe(1);
      expect(result.matchingPolicyVersion).toBe('v2');
      expect(result.unavailableReason).toBeNull();
    });

    it('distinguishes legitimate zero matches (matched=0) from missing metadata', () => {
      const zeroMeta = {
        matchedRows: 0,
        matchedPlaces: 0,
        unmatchedAttractions: 100,
        ambiguousAttractions: 0,
      };
      const result = parseImportRunMatchingDiagnostics(zeroMeta);
      expect(result.status).toBe('available');
      expect(result.matchedRows).toBe(0);
      expect(result.matchedPlaces).toBe(0);
      expect(result.unmatchedAttractions).toBe(100);
    });

    it('returns unavailable without manufacturing zeros for old runs without metadata', () => {
      const legacyMeta = { schemaVersion: 'v1' };
      const result = parseImportRunMatchingDiagnostics(legacyMeta);
      expect(result.status).toBe('unavailable');
      expect(result.matchedRows).toBeNull();
      expect(result.matchedPlaces).toBeNull();
      expect(result.unmatchedAttractions).toBeNull();
      expect(result.ambiguousAttractions).toBeNull();
      expect(result.unavailableReason).toContain('매칭 진단 통계');
    });

    it('handles null or undefined metadata safely', () => {
      expect(parseImportRunMatchingDiagnostics(null).status).toBe('unavailable');
      expect(parseImportRunMatchingDiagnostics(undefined).status).toBe('unavailable');
    });
  });

  describe('Determinism Evaluation', () => {
    const baseRun: ScenarioRunComparable = {
      baselineStops: ['p1', 'p2', 'p3'],
      michiStops: ['p1', 'p4', 'p5'],
      evidenceStatus: 'partial',
      delta: {
        averagePreferenceScore: 0.1,
        tourismConcentrationScore: null,
        averageTravelDistanceKm: -0.5,
      },
    };

    it('reports not_checked for 1 run without falsely claiming PASS', () => {
      const result = checkRunsDeterminism([baseRun]);
      expect(result.determinismStatus).toBe('not_checked');
      expect(result.isDeterministic).toBe(true);
    });

    it('reports pass when 2 or more runs have identical stops and metrics', () => {
      const run1 = { ...baseRun };
      const run2 = { ...baseRun };
      const result = checkRunsDeterminism([run1, run2]);
      expect(result.determinismStatus).toBe('pass');
      expect(result.isDeterministic).toBe(true);
    });

    it('reports fail when baseline or michi stops differ between runs', () => {
      const run1 = { ...baseRun };
      const run2 = { ...baseRun, michiStops: ['p1', 'p4', 'p6'] };
      const result = checkRunsDeterminism([run1, run2]);
      expect(result.determinismStatus).toBe('fail');
      expect(result.isDeterministic).toBe(false);
    });

    it('reports fail when delta metrics differ between runs', () => {
      const run1 = { ...baseRun };
      const run2 = {
        ...baseRun,
        delta: { ...baseRun.delta, averageTravelDistanceKm: -0.2 },
      };
      const result = checkRunsDeterminism([run1, run2]);
      expect(result.determinismStatus).toBe('fail');
      expect(result.isDeterministic).toBe(false);
    });

    it('reports fail when evidenceStatus differs between runs', () => {
      const run1 = { ...baseRun };
      const run2 = { ...baseRun, evidenceStatus: 'available' as const };
      const result = checkRunsDeterminism([run1, run2]);
      expect(result.determinismStatus).toBe('fail');
      expect(result.isDeterministic).toBe(false);
    });

    it('reports fail when the evidence-controlled benchmark changes', () => {
      const run1 = {
        ...baseRun,
        controlledBaselineStops: ['p1', 'p2'],
        controlledMichiStops: ['p2', 'p1'],
        controlledDelta: { tourismConcentrationScore: -0.2 },
      };
      const run2 = {
        ...run1,
        controlledMichiStops: ['p1', 'p2'],
      };

      expect(checkRunsDeterminism([run1, run2])).toEqual({
        determinismStatus: 'fail',
        isDeterministic: false,
      });
    });
  });

  describe('Coverage Aggregation & Mode Determination', () => {
    it('aggregates scenario coverages and calculates evidence status ratios', () => {
      const scenarios: ScenarioCoverageItem[] = [
        {
          totalCandidates: 50,
          candidatesWithConcentration: 5,
          candidateCoverageRatio: 0.1,
          baselineSelectedCount: 3,
          baselineSelectedWithConcentration: 1,
          baselineCoverageRatio: 0.3333,
          michiSelectedCount: 3,
          michiSelectedWithConcentration: 0,
          michiCoverageRatio: 0,
          evidenceStatus: 'partial',
        },
        {
          totalCandidates: 50,
          candidatesWithConcentration: 15,
          candidateCoverageRatio: 0.3,
          baselineSelectedCount: 3,
          baselineSelectedWithConcentration: 2,
          baselineCoverageRatio: 0.6667,
          michiSelectedCount: 3,
          michiSelectedWithConcentration: 0,
          michiCoverageRatio: 0,
          evidenceStatus: 'partial',
        },
      ];

      const agg = aggregateCoverage(scenarios);
      expect(agg.totalCandidates).toBe(100);
      expect(agg.candidatesWithConcentration).toBe(20);
      expect(agg.candidateCoverageRatio).toBe(0.2);
      expect(agg.totalBaselineSelected).toBe(6);
      expect(agg.baselineSelectedWithConcentration).toBe(3);
      expect(agg.baselineCoverageRatio).toBe(0.5);
      expect(agg.totalMichiSelected).toBe(6);
      expect(agg.michiSelectedWithConcentration).toBe(0);
      expect(agg.michiCoverageRatio).toBe(0);
      expect(agg.evidenceStatusCounts.partial).toBe(2);
      expect(agg.evidenceStatusCounts.available).toBe(0);
      expect(agg.evidenceStatusRatios.partial).toBe(1.0);
    });

    it('determines overall data mode accurately', () => {
      expect(determineOverallDataMode(['live', 'live'])).toBe('live');
      expect(determineOverallDataMode(['mock', 'mock'])).toBe('mock');
      expect(determineOverallDataMode(['live', 'mock'])).toBe('mixed');
      expect(determineOverallDataMode(['live', 'mixed'])).toBe('mixed');
    });

    it('formats short IDs safely', () => {
      expect(formatShortId('12345678-abcd-1234-abcd-1234567890ab')).toBe('12345678');
      expect(formatShortId('short')).toBe('short');
      expect(formatShortId(null)).toBe('N/A');
    });
  });
});
