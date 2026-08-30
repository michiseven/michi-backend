import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { EVALUATION_SCENARIOS } from '../evaluation/evaluation-scenarios';
import { EvaluationService, type EvaluationResponseDto } from '../evaluation/evaluation.service';
import { PreferencesService } from '../preferences/preferences.service';
import { DataSource } from 'typeorm';
import { Place, TourismDataSource, TourismImportRun, TourismMetric } from '../database/entities';
import { KTO_PLACE_SOURCE } from '../providers/place/kto-place.provider';
import { KTO_DATALAB_CONCENTRATION_DATASET_KEY } from '../tourism-data/kto-datalab-concentration.provider';
import {
  aggregateCoverage,
  checkRunsDeterminism,
  computeImportRunMetricsScope,
  determineOverallDataMode,
  findLatestCompletedImportRun,
  formatShortId,
  type DeterminismStatus,
  type LatestImportSummary,
  type MatchingDiagnostics,
  type OverallCoverageSummary,
  type ScenarioCoverageItem,
  type ScenarioRunComparable,
} from './evaluation-coverage-calculator';

interface CliOptions {
  runs: number;
  outputFile: string | null;
  jsonOnly: boolean;
  scenarioId: string | null;
}

interface ScenarioRunResult {
  runIndex: number;
  response: EvaluationResponseDto;
}

export interface ScenarioAuditResult extends ScenarioCoverageItem {
  scenarioId: string;
  label: string;
  runs: number;
  deterministic: boolean;
  determinismStatus: DeterminismStatus;
  dataMode: string;
  baselineStops: Array<{ placeName: string; concentrationLevel?: string }>;
  michiStops: Array<{ placeName: string; concentrationLevel?: string }>;
  delta: Record<string, number | null>;
  expectedEffect: EvaluationResponseDto['expectedEffect'];
  evidenceControlledBenchmark: EvaluationResponseDto['evidenceControlledBenchmark'];
  dataSources: EvaluationResponseDto['dataSources'];
  warnings: string[];
}

export interface EvaluationCoverageReport {
  title: string;
  executedAt: string;
  algorithmVersion: string;
  runsPerScenario: number;
  overallDeterminism: boolean;
  determinismStatus: DeterminismStatus;
  overallDataMode: 'live' | 'mock' | 'mixed';
  latestImport: LatestImportSummary;
  matching: MatchingDiagnostics;
  dataSourceSummary: {
    datasetKey: string;
    referencePeriod: string | null;
    totalKtoPlaces: number;
    ktoPlacesWithConcentration: number;
    ktoPlaceCoverageRatio: number;
    totalConcentrationRows: number;
    latestImportAt: string | null;
    mode: string;
  };
  overallCoverage: OverallCoverageSummary;
  scenarios: ScenarioAuditResult[];
  warnings: string[];
}

function parseCliOptions(): CliOptions {
  const args = process.argv.slice(2);
  let runs = 2;
  let outputFile: string | null = null;
  let jsonOnly = false;
  let scenarioId: string | null = null;

  for (const arg of args) {
    if (arg.startsWith('--runs=')) {
      const val = parseInt(arg.slice('--runs='.length), 10);
      if (!isNaN(val) && val > 0) runs = val;
    } else if (arg.startsWith('--output=')) {
      outputFile = arg.slice('--output='.length).trim();
    } else if (arg === '--json') {
      jsonOnly = true;
    } else if (arg.startsWith('--scenario=')) {
      scenarioId = arg.slice('--scenario='.length).trim();
    }
  }

  return { runs, outputFile, jsonOnly, scenarioId };
}

export async function runEvaluationCoverageAudit(
  options: CliOptions,
): Promise<EvaluationCoverageReport> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const evaluationService = app.get(EvaluationService);
    const preferencesService = app.get(PreferencesService);
    const dataSource = app.get(DataSource);

    const placeRepo = dataSource.getRepository(Place);
    const sourceRepo = dataSource.getRepository(TourismDataSource);
    const importRunRepo = dataSource.getRepository(TourismImportRun);
    const metricRepo = dataSource.getRepository(TourismMetric);

    const totalKtoPlaces = await placeRepo.count({ where: { source: KTO_PLACE_SOURCE } });

    const datalabSource = await sourceRepo.findOne({
      where: { datasetKey: KTO_DATALAB_CONCENTRATION_DATASET_KEY },
    });

    const completedRuns = datalabSource
      ? await importRunRepo.find({
          where: { sourceId: datalabSource.id, status: 'completed' },
          order: { completedAt: 'DESC', startedAt: 'DESC' },
        })
      : [];

    const latestRun = findLatestCompletedImportRun(completedRuns);

    const scopedMetrics = latestRun
      ? await metricRepo.find({
          where: { importRunId: latestRun.id },
          select: { id: true, importRunId: true, placeId: true },
        })
      : [];

    const {
      latestImport,
      matching,
      warnings: scopeWarnings,
    } = computeImportRunMetricsScope(latestRun, scopedMetrics, totalKtoPlaces);

    const targetScenarios = options.scenarioId
      ? EVALUATION_SCENARIOS.filter((s) => s.id === options.scenarioId)
      : EVALUATION_SCENARIOS;

    if (targetScenarios.length === 0) {
      throw new Error(`No scenario matching ID: ${options.scenarioId}`);
    }

    const scenarioResults: ScenarioAuditResult[] = [];
    const reportWarnings = [...scopeWarnings];

    for (const scenario of targetScenarios) {
      const parsed = await preferencesService.parse(scenario.input);
      const runs: ScenarioRunResult[] = [];
      for (let r = 1; r <= options.runs; r++) {
        const response = await evaluationService.compareParsed(parsed, scenario.input);
        runs.push({ runIndex: r, response });
      }

      const comparables: ScenarioRunComparable[] = runs.map((r) => ({
        baselineStops: r.response.baseline.route.stops.map((s) => s.placeId),
        michiStops: r.response.michi.route.stops.map((s) => s.placeId),
        evidenceStatus: r.response.expectedEffect.evidenceStatus,
        delta: r.response.delta,
        controlledBaselineStops: r.response.evidenceControlledBenchmark.baseline.route.stops.map(
          (s) => s.placeId,
        ),
        controlledMichiStops: r.response.evidenceControlledBenchmark.michi.route.stops.map(
          (s) => s.placeId,
        ),
        controlledDelta: r.response.evidenceControlledBenchmark.delta,
      }));

      const { determinismStatus, isDeterministic } = checkRunsDeterminism(comparables);

      const representative = runs[0]!.response;
      const coverage = representative.coverage ?? {
        totalCandidates: 0,
        candidatesWithConcentration: 0,
        candidateCoverageRatio: 0,
        baselineSelectedCount: representative.baseline.route.stops.length,
        baselineSelectedWithConcentration: representative.baseline.route.stops.filter(
          (s) => s.concentrationLevel && s.concentrationLevel !== 'unavailable',
        ).length,
        baselineCoverageRatio: 0,
        michiSelectedCount: representative.michi.route.stops.length,
        michiSelectedWithConcentration: representative.michi.route.stops.filter(
          (s) => s.concentrationLevel && s.concentrationLevel !== 'unavailable',
        ).length,
        michiCoverageRatio: 0,
      };

      scenarioResults.push({
        scenarioId: scenario.id,
        label: scenario.label,
        runs: options.runs,
        deterministic: isDeterministic,
        determinismStatus,
        dataMode: representative.dataMode,
        evidenceStatus: representative.expectedEffect.evidenceStatus,
        totalCandidates: coverage.totalCandidates,
        candidatesWithConcentration: coverage.candidatesWithConcentration,
        candidateCoverageRatio: coverage.candidateCoverageRatio,
        baselineSelectedCount: coverage.baselineSelectedCount,
        baselineSelectedWithConcentration: coverage.baselineSelectedWithConcentration,
        baselineCoverageRatio: coverage.baselineCoverageRatio,
        michiSelectedCount: coverage.michiSelectedCount,
        michiSelectedWithConcentration: coverage.michiSelectedWithConcentration,
        michiCoverageRatio: coverage.michiCoverageRatio,
        baselineStops: representative.baseline.route.stops.map((s) => ({
          placeName: s.placeName,
          concentrationLevel: s.concentrationLevel,
        })),
        michiStops: representative.michi.route.stops.map((s) => ({
          placeName: s.placeName,
          concentrationLevel: s.concentrationLevel,
        })),
        delta: representative.delta,
        expectedEffect: representative.expectedEffect,
        evidenceControlledBenchmark: representative.evidenceControlledBenchmark,
        dataSources: representative.dataSources,
        warnings: representative.warnings,
      });
    }

    const overallCoverage = aggregateCoverage(scenarioResults);
    const overallDataMode = determineOverallDataMode(scenarioResults.map((s) => s.dataMode));

    let overallDeterminismStatus: DeterminismStatus = 'pass';
    if (options.runs <= 1) {
      overallDeterminismStatus = 'not_checked';
    } else if (scenarioResults.some((s) => s.determinismStatus === 'fail')) {
      overallDeterminismStatus = 'fail';
    }

    const overallDeterminism = overallDeterminismStatus === 'pass';

    return {
      title: 'Michi LIVE Evaluation Coverage & Reliability Audit',
      executedAt: new Date().toISOString(),
      algorithmVersion:
        scenarioResults[0]?.expectedEffect.algorithmVersion ?? 'expected-dispersion-effect-v1',
      runsPerScenario: options.runs,
      overallDeterminism,
      determinismStatus: overallDeterminismStatus,
      overallDataMode,
      latestImport,
      matching,
      dataSourceSummary: {
        datasetKey: KTO_DATALAB_CONCENTRATION_DATASET_KEY,
        referencePeriod: latestImport.referencePeriod,
        totalKtoPlaces,
        ktoPlacesWithConcentration: latestImport.ktoPlacesWithConcentration,
        ktoPlaceCoverageRatio: latestImport.ktoPlaceCoverageRatio,
        totalConcentrationRows: latestImport.metricRows ?? 0,
        latestImportAt: latestImport.completedAt,
        mode: latestImport.mode,
      },
      overallCoverage,
      scenarios: scenarioResults,
      warnings: [...new Set(reportWarnings)],
    };
  } finally {
    await app.close();
  }
}

function printReportText(report: EvaluationCoverageReport): void {
  process.stdout.write(
    `\n================================================================================\n`,
  );
  process.stdout.write(` ${report.title}\n`);
  process.stdout.write(
    `================================================================================\n`,
  );
  process.stdout.write(` 실행 시각: ${report.executedAt}\n`);
  process.stdout.write(` 알고리즘: ${report.algorithmVersion}\n`);
  process.stdout.write(` 데이터 모드: ${report.overallDataMode.toUpperCase()}\n`);
  process.stdout.write(` 시나리오별 반복 횟수: ${report.runsPerScenario}회\n`);

  const determinismLabel =
    report.determinismStatus === 'not_checked'
      ? 'NOT_CHECKED (1회 실행으로 미검증)'
      : report.determinismStatus === 'pass'
        ? 'PASS (100% 동일)'
        : 'FAIL (불일치 발생)';
  process.stdout.write(` 반복 결정론성: ${determinismLabel}\n`);

  process.stdout.write(`\n[최신 DataLab 관광 데이터 임포트 현황]\n`);
  process.stdout.write(` - ImportRun ID: ${formatShortId(report.latestImport.importRunId)}\n`);
  process.stdout.write(` - 기준 기간: ${report.latestImport.referencePeriod ?? '미지정'}\n`);
  process.stdout.write(` - 모드: ${report.latestImport.mode.toUpperCase()}\n`);
  process.stdout.write(` - 완료 시각: ${report.latestImport.completedAt ?? 'N/A'}\n`);
  process.stdout.write(
    ` - 지표 행수(최신 Run 한정): ${report.latestImport.metricRows ?? 'N/A'}행\n`,
  );
  process.stdout.write(
    ` - 지표 연결 KTO 장소: ${report.latestImport.ktoPlacesWithConcentration} / ${report.latestImport.totalKtoPlaces} (${(report.latestImport.ktoPlaceCoverageRatio * 100).toFixed(1)}%)\n`,
  );

  process.stdout.write(`\n[KTO-DataLab 매칭 진단 통계]\n`);
  if (report.matching.status === 'available') {
    process.stdout.write(
      ` - 매칭 상태: AVAILABLE (정책: ${report.matching.matchingPolicyVersion ?? '기본'})\n`,
    );
    process.stdout.write(
      ` - API Fetch: ${report.matching.fetched ?? 'N/A'}행 (${report.matching.districts ?? 'N/A'}개 자치구, ${report.matching.pages ?? 'N/A'}페이지)\n`,
    );
    process.stdout.write(` - Provider Reject: ${report.matching.rejectedByProvider ?? 0}건\n`);
    process.stdout.write(
      ` - 유일 매칭 장소: ${report.matching.matchedPlaces ?? 'N/A'}곳 (${report.matching.matchedRows ?? 'N/A'}행 적재)\n`,
    );
    process.stdout.write(
      ` - 고유 불일치 관광지: ${report.matching.unmatchedAttractions ?? 'N/A'}곳\n`,
    );
    process.stdout.write(
      ` - 다중 일치(ambiguous) 제외: ${report.matching.ambiguousAttractions ?? 'N/A'}곳\n`,
    );
  } else {
    process.stdout.write(
      ` - 매칭 상태: UNAVAILABLE (${report.matching.unavailableReason ?? '진단 정보 없음'})\n`,
    );
  }

  process.stdout.write(`\n[5개 고정 시나리오 종합 커버리지]\n`);
  process.stdout.write(
    ` - 전체 후보 장소: ${report.overallCoverage.totalCandidates}개 (※ LIVE 검색 결과에 따라 가변적)\n`,
  );
  process.stdout.write(
    ` - 관광 지표 연결 후보: ${report.overallCoverage.candidatesWithConcentration}개 (${(report.overallCoverage.candidateCoverageRatio * 100).toFixed(1)}%)\n`,
  );
  process.stdout.write(
    ` - Baseline 선택 장소 지표 연결: ${report.overallCoverage.baselineSelectedWithConcentration} / ${report.overallCoverage.totalBaselineSelected} (${(report.overallCoverage.baselineCoverageRatio * 100).toFixed(1)}%)\n`,
  );
  process.stdout.write(
    ` - Michi 선택 장소 지표 연결: ${report.overallCoverage.michiSelectedWithConcentration} / ${report.overallCoverage.totalMichiSelected} (${(report.overallCoverage.michiCoverageRatio * 100).toFixed(1)}%)\n`,
  );
  process.stdout.write(
    ` - Evidence Status 분포: available ${report.overallCoverage.evidenceStatusCounts.available}건 (${(report.overallCoverage.evidenceStatusRatios.available * 100).toFixed(0)}%) | partial ${report.overallCoverage.evidenceStatusCounts.partial}건 (${(report.overallCoverage.evidenceStatusRatios.partial * 100).toFixed(0)}%) | unavailable ${report.overallCoverage.evidenceStatusCounts.unavailable}건 (${(report.overallCoverage.evidenceStatusRatios.unavailable * 100).toFixed(0)}%)\n`,
  );

  if (report.warnings.length > 0) {
    process.stdout.write(`\n[경고]\n`);
    for (const w of report.warnings) {
      process.stdout.write(` ! ${w}\n`);
    }
  }

  process.stdout.write(`\n[시나리오별 상세 결과]\n`);
  for (const s of report.scenarios) {
    process.stdout.write(
      `--------------------------------------------------------------------------------\n`,
    );
    process.stdout.write(` [${s.scenarioId}] ${s.label}\n`);
    const scDet =
      s.determinismStatus === 'not_checked'
        ? 'NOT_CHECKED'
        : s.determinismStatus === 'pass'
          ? 'PASS'
          : 'FAIL';
    process.stdout.write(
      `  • Evidence Status: ${s.evidenceStatus} | Mode: ${s.dataMode} | Deterministic: ${scDet}\n`,
    );
    process.stdout.write(
      `  • 후보 Coverage: ${s.candidatesWithConcentration}/${s.totalCandidates} (${(s.candidateCoverageRatio * 100).toFixed(1)}%)\n`,
    );
    process.stdout.write(
      `  • Baseline 선택 (${s.baselineSelectedCount}곳): ${s.baselineStops.map((st) => `${st.placeName}[${st.concentrationLevel ?? 'unavail'}]`).join(' -> ')}\n`,
    );
    process.stdout.write(
      `  • Michi 선택 (${s.michiSelectedCount}곳): ${s.michiStops.map((st) => `${st.placeName}[${st.concentrationLevel ?? 'unavail'}]`).join(' -> ')}\n`,
    );
    process.stdout.write(
      `  • 주요 Delta: 이동거리 ${s.delta.averageTravelDistanceKm ?? 'null'}km | 이동시간 ${s.delta.averageTravelTimeMinutes ?? 'null'}분 | 집중도 ${s.delta.tourismConcentrationScore ?? 'null'}\n`,
    );
    const controlled = s.evidenceControlledBenchmark;
    process.stdout.write(
      `  • 근거 통제 비교: ${controlled.status} | 대상 ${controlled.candidatePool.eligibleCandidates}곳 | 선택 ${controlled.candidatePool.evaluatedSelectionCount}/${controlled.candidatePool.requestedSelectionCount}곳\n`,
    );
    process.stdout.write(
      `  • 근거 통제 효과: 집중도 완화 ${controlled.expectedEffect.concentrationReduction ?? 'null'} | 비핫스팟 증가 ${controlled.expectedEffect.nonHotspotInclusionLift ?? 'null'} | 취향 변화 ${controlled.expectedEffect.preferenceChange ?? 'null'}\n`,
    );
  }
  process.stdout.write(
    `================================================================================\n\n`,
  );
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  const report = await runEvaluationCoverageAudit(options);

  if (options.outputFile) {
    const resolvedPath = path.resolve(process.cwd(), options.outputFile);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, JSON.stringify(report, null, 2), 'utf8');
    process.stdout.write(`[INFO] Report saved to ${resolvedPath}\n`);
  }

  if (options.jsonOnly) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printReportText(report);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `Evaluation coverage audit failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
