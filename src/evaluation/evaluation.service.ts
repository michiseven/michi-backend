import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Place, RecommendationEvaluation } from '../database/entities';
import { PreferencesService } from '../preferences/preferences.service';
import type { PreferenceParseResult } from '../preferences/preference.types';
import { PlaceNormalizer } from '../providers/place/place-normalizer';
import { PLACE_PROVIDER, type PlaceProvider } from '../providers/place/place-provider';
import { PlaceCandidateSearchService } from '../providers/place/place-candidate-search.service';
import { PlaceDeduplicator } from '../providers/place/place-deduplicator';
import { seoulDistrictForArea } from '../providers/place/seoul-area-centers';
import {
  CANDIDATE_RANKER,
  ROUTE_OPTIMIZER,
  type CandidatePlace,
  type CandidateRanker,
  type RankedCandidate,
  type RouteOptimizer,
} from '../recommendation/ports';
import { coordinatesOf, haversineDistanceKm, type Coordinates } from '../recommendation/geo';
import { TourismFeatureService } from '../tourism-feature/tourism-feature.service';
import { DEFAULT_PREFERENCE_THRESHOLD } from '../tourism-feature/local-impact';
import type {
  TourismDataMode,
  TourismSourceEvidence,
} from '../tourism-feature/tourism-feature.types';
import { GenerateTripDto } from '../trips/dto/generate-trip.dto';
import { PlaceSearchQueryGenerator } from '../trips/place-search-query-generator';
import {
  evaluateBaselineAndMichi,
  type EvaluatedCandidate,
  type EvaluationMetrics,
  type ExpectedDispersionEffect,
  type RecommendationEvaluationVariant,
} from './algorithm/recommendation-evaluator';
import {
  evaluateEvidenceControlledBenchmark,
  type EvidenceControlledBenchmarkStatus,
} from './algorithm/evidence-controlled-benchmark';

type MetricUnit = 'ratio' | 'km' | 'minutes';

interface EvaluationMetricDto {
  value: number | null;
  unit: MetricUnit;
  status: 'measured' | 'unavailable';
  sampleSize: number;
}

type MetricsDto = Record<keyof EvaluationMetrics, EvaluationMetricDto>;

interface EvaluationRouteStopDto {
  placeId: string;
  placeName: string;
  arrivalAt: string;
  concentrationLevel?: 'low' | 'medium' | 'high' | 'unavailable';
}

interface EvaluationVariantDto {
  algorithmVersion: string;
  metrics: MetricsDto;
  route: { stops: EvaluationRouteStopDto[] };
}

export interface EvidenceControlledBenchmarkDto {
  algorithmVersion: string;
  status: EvidenceControlledBenchmarkStatus;
  candidatePool: {
    totalCandidates: number;
    candidatesWithConcentration: number;
    excludedMissingConcentration: number;
    excludedBelowPreferenceThreshold: number;
    eligibleCandidates: number;
    requestedSelectionCount: number;
    evaluatedSelectionCount: number;
  };
  baseline: EvaluationVariantDto;
  michi: EvaluationVariantDto;
  delta: Record<keyof EvaluationMetrics, number | null>;
  expectedEffect: ExpectedDispersionEffect;
}

export interface EvaluationCoverageDto {
  totalCandidates: number;
  candidatesWithConcentration: number;
  candidateCoverageRatio: number;
  baselineSelectedCount: number;
  baselineSelectedWithConcentration: number;
  baselineCoverageRatio: number;
  michiSelectedCount: number;
  michiSelectedWithConcentration: number;
  michiCoverageRatio: number;
}

export interface EvaluationResponseDto {
  evaluationId: string;
  generatedAt: string;
  preference: Record<string, unknown>;
  dataMode: 'live' | 'mock' | 'mixed';
  baseline: EvaluationVariantDto;
  michi: EvaluationVariantDto;
  delta: Record<keyof EvaluationMetrics, number | null>;
  expectedEffect: ExpectedDispersionEffect;
  evidenceControlledBenchmark: EvidenceControlledBenchmarkDto;
  coverage?: EvaluationCoverageDto;
  dataSources: TourismSourceEvidence[];
  warnings: string[];
}

const METRIC_UNITS: Record<keyof EvaluationMetrics, MetricUnit> = {
  averagePreferenceScore: 'ratio',
  tourismConcentrationScore: 'ratio',
  nonHotspotInclusionRate: 'ratio',
  averageTravelDistanceKm: 'km',
  averageTravelTimeMinutes: 'minutes',
  localImpactScore: 'ratio',
};

function clusterCenter(places: readonly CandidatePlace[]): Coordinates | null {
  const points = places
    .map((place) => coordinatesOf(place.location))
    .filter((point): point is Coordinates => point !== null);
  if (points.length === 0) return null;
  return {
    longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
    latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
  };
}

function level(value: number | null): 'low' | 'medium' | 'high' | 'unavailable' {
  if (value === null) return 'unavailable';
  if (value < 1 / 3) return 'low';
  if (value < 2 / 3) return 'medium';
  return 'high';
}

function sampleSize(
  variant: RecommendationEvaluationVariant,
  key: keyof EvaluationMetrics,
): number {
  if (key === 'averagePreferenceScore') return variant.selected.length;
  if (key === 'tourismConcentrationScore' || key === 'nonHotspotInclusionRate') {
    return variant.selected.filter((candidate) => candidate.concentration !== null).length;
  }
  if (key === 'averageTravelDistanceKm') {
    return variant.selected.filter((candidate) => candidate.distanceKm !== null).length;
  }
  if (key === 'averageTravelTimeMinutes') {
    return variant.selected.filter((candidate) => candidate.travelTimeMinutes !== null).length;
  }
  return variant.selected.filter((candidate) => candidate.localImpact !== null).length;
}

function metricsDto(variant: RecommendationEvaluationVariant): MetricsDto {
  return Object.fromEntries(
    (Object.keys(METRIC_UNITS) as Array<keyof EvaluationMetrics>).map((key) => {
      const value = variant.metrics[key];
      return [
        key,
        {
          value,
          unit: METRIC_UNITS[key],
          status: value === null ? 'unavailable' : 'measured',
          sampleSize: sampleSize(variant, key),
        },
      ];
    }),
  ) as MetricsDto;
}

@Injectable()
export class EvaluationService {
  constructor(
    @InjectRepository(Place) private readonly places: Repository<Place>,
    @InjectRepository(RecommendationEvaluation)
    private readonly evaluations: Repository<RecommendationEvaluation>,
    private readonly preferences: PreferencesService,
    private readonly queryGenerator: PlaceSearchQueryGenerator,
    private readonly normalizer: PlaceNormalizer,
    private readonly candidateSearch: PlaceCandidateSearchService,
    private readonly deduplicator: PlaceDeduplicator,
    private readonly tourismFeatures: TourismFeatureService,
    @Inject(PLACE_PROVIDER) private readonly placeProvider: PlaceProvider,
    @Inject(CANDIDATE_RANKER) private readonly ranker: CandidateRanker,
    @Inject(ROUTE_OPTIMIZER) private readonly routeOptimizer: RouteOptimizer,
  ) {}

  async compare(dto: GenerateTripDto): Promise<EvaluationResponseDto> {
    const parsed = await this.preferences.parse(dto);
    return this.compareParsed(parsed, dto);
  }

  async compareParsed(
    parsed: PreferenceParseResult,
    dto: GenerateTripDto,
  ): Promise<EvaluationResponseDto> {
    const area = parsed.preference.area ?? dto.startArea;
    if (!area) {
      throw new BadRequestException({
        code: 'AREA_REQUIRED',
        message: '서울 지역을 입력해 주세요.',
      });
    }
    const travelDate = this.resolveTravelDate(dto.travelDate);
    const queries = this.queryGenerator.generate({ ...parsed.preference, area });
    const [placeResponses, ktoCandidates] = await Promise.all([
      Promise.all(queries.map((query) => this.placeProvider.search({ query, area, limit: 5 }))),
      this.candidateSearch.searchKtoCandidates({
        area,
        interests: parsed.preference.interests,
        limit: 40,
      }),
    ]);
    const records = placeResponses
      .flatMap((response) => response.places)
      .filter(
        (record, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.provider === record.provider &&
              candidate.sourcePlaceId === record.sourcePlaceId,
          ) === index,
      );
    const persisted = await Promise.all(
      records.map(async (record) => {
        const normalized = this.normalizer.normalize(record);
        const existing = await this.places.findOneBy({
          source: normalized.source,
          sourcePlaceId: normalized.sourcePlaceId,
        });
        return this.places.save(this.places.create({ ...existing, ...normalized }));
      }),
    );
    const deduplicated = this.deduplicator.deduplicate([...ktoCandidates, ...persisted]);
    const candidates: CandidatePlace[] = deduplicated.places.flatMap((place) =>
      place.location
        ? [
            {
              placeId: place.id,
              source: place.source,
              sourcePlaceId: place.sourcePlaceId,
              name: place.name,
              category: place.category,
              address: place.address,
              roadAddress: place.roadAddress,
              location: place.location,
              district: place.district,
              rawCategory: place.rawCategory,
              rawPayload: place.rawPayload,
            },
          ]
        : [],
    );
    if (candidates.length === 0) {
      throw new UnprocessableEntityException({
        code: 'NO_PLACE_CANDIDATES',
        message: '같은 입력으로 비교할 서울 장소 후보를 찾지 못했습니다.',
      });
    }
    const tourismByPlace = await this.tourismFeatures.forPlaces(
      candidates,
      [area, seoulDistrictForArea(area)].filter((value): value is string => Boolean(value)),
      travelDate,
    );
    const ranking = this.ranker.rank({
      preference: { ...parsed.preference, area },
      places: candidates.map((candidate) => ({
        ...candidate,
        tourism: tourismByPlace.get(candidate.placeId),
      })),
      crowd: null,
    });
    const center = clusterCenter(ranking.candidates.map((candidate) => candidate.place));
    const inputById = new Map(
      ranking.candidates.map((candidate) => {
        const point = coordinatesOf(candidate.place.location);
        const distanceKm = point && center ? haversineDistanceKm(point, center) : null;
        return [
          candidate.place.placeId,
          {
            id: candidate.place.placeId,
            preferenceScore: candidate.scoreBreakdown.preference,
            popularityScore: candidate.place.tourism?.concentration.concentration ?? null,
            distanceScore: candidate.scoreBreakdown.distance,
            timeScore: candidate.scoreBreakdown.time,
            distanceKm,
            travelTimeMinutes:
              distanceKm === null ? null : Math.max(5, Math.ceil((distanceKm / 4.5) * 60)),
            tourismResult: candidate.place.tourism?.concentration,
            alternativeSimilarity:
              candidate.place.tourism &&
              (candidate.place.tourism.concentration.concentration !== null ||
                candidate.place.tourism.tourismFlow !== null)
                ? candidate.scoreBreakdown.preference
                : null,
            tourismFlow: candidate.place.tourism?.tourismFlow ?? null,
          },
        ] as const;
      }),
    );
    const preferenceThreshold =
      parsed.preference.interests.length === 0 ? 0.5 : DEFAULT_PREFERENCE_THRESHOLD;
    const evaluationCandidates = [...inputById.values()];
    const requestedSelectionCount = Math.min(3, ranking.candidates.length);
    const report = evaluateBaselineAndMichi({
      candidates: evaluationCandidates,
      limit: requestedSelectionCount,
      preferenceThreshold,
    });
    const evidenceControlled = evaluateEvidenceControlledBenchmark({
      candidates: evaluationCandidates,
      limit: requestedSelectionCount,
      preferenceThreshold,
    });
    const rankedById = new Map(
      ranking.candidates.map((candidate) => [candidate.place.placeId, candidate]),
    );
    const baselineRoute = this.routeFor(
      report.baseline.selected,
      rankedById,
      travelDate,
      parsed.preference,
    );
    const michiRoute = this.routeFor(
      report.michi.selected,
      rankedById,
      travelDate,
      parsed.preference,
    );
    const evidenceControlledBaselineRoute = this.routeFor(
      evidenceControlled.evaluation.baseline.selected,
      rankedById,
      travelDate,
      parsed.preference,
    );
    const evidenceControlledMichiRoute = this.routeFor(
      evidenceControlled.evaluation.michi.selected,
      rankedById,
      travelDate,
      parsed.preference,
    );
    const sources = this.sourcesOf(ranking.candidates);
    const tourismMode = this.dataModeOf(sources);
    const dataMode = this.overallDataMode(tourismMode, parsed.parserMode);
    const saved = await this.evaluations.save(
      this.evaluations.create({
        scenarioKey: null,
        preferenceSnapshot: { ...parsed.preference, area },
        candidateSnapshot: ranking.candidates.map((candidate) => ({
          placeId: candidate.place.placeId,
          source: candidate.place.source,
          sourcePlaceId: candidate.place.sourcePlaceId,
          preferenceScore: candidate.scoreBreakdown.preference,
          distanceScore: candidate.scoreBreakdown.distance,
          timeScore: candidate.scoreBreakdown.time,
          tourismConcentration: candidate.place.tourism?.concentration.concentration ?? null,
          tourismSourceRefs:
            candidate.place.tourism?.sources.map((source) => source.sourceRef) ?? [],
        })),
        dataMode,
        baselineAlgorithmVersion: report.baseline.algorithmVersion,
        michiAlgorithmVersion: report.michi.algorithmVersion,
        baselineMetrics: { ...report.baseline.metrics },
        michiMetrics: { ...report.michi.metrics },
        delta: { ...report.delta },
        evidenceControlledBenchmark: {
          algorithmVersion: evidenceControlled.algorithmVersion,
          status: evidenceControlled.status,
          candidatePool: { ...evidenceControlled.candidatePool },
          baselineAlgorithmVersion: evidenceControlled.evaluation.baseline.algorithmVersion,
          michiAlgorithmVersion: evidenceControlled.evaluation.michi.algorithmVersion,
          baselineSelectedPlaceIds: evidenceControlled.evaluation.baseline.selected.map(
            ({ id }) => id,
          ),
          michiSelectedPlaceIds: evidenceControlled.evaluation.michi.selected.map(({ id }) => id),
          baselineMetrics: { ...evidenceControlled.evaluation.baseline.metrics },
          michiMetrics: { ...evidenceControlled.evaluation.michi.metrics },
          delta: { ...evidenceControlled.evaluation.delta },
          expectedEffect: { ...evidenceControlled.evaluation.expectedEffect },
        },
        sourceSnapshot: sources.map((source) => ({ ...source })),
        randomSeed: null,
      }),
    );
    const totalCandidates = ranking.candidates.length;
    const candidatesWithConcentration = ranking.candidates.filter(
      (c) =>
        c.place.tourism?.concentration.concentration !== null &&
        c.place.tourism?.concentration.concentration !== undefined,
    ).length;
    const candidateCoverageRatio =
      totalCandidates > 0 ? Number((candidatesWithConcentration / totalCandidates).toFixed(4)) : 0;

    const baselineSelectedCount = report.baseline.selected.length;
    const baselineSelectedWithConcentration = report.baseline.selected.filter(
      (s) => s.concentration !== null && s.concentration !== undefined,
    ).length;
    const baselineCoverageRatio =
      baselineSelectedCount > 0
        ? Number((baselineSelectedWithConcentration / baselineSelectedCount).toFixed(4))
        : 0;

    const michiSelectedCount = report.michi.selected.length;
    const michiSelectedWithConcentration = report.michi.selected.filter(
      (s) => s.concentration !== null && s.concentration !== undefined,
    ).length;
    const michiCoverageRatio =
      michiSelectedCount > 0
        ? Number((michiSelectedWithConcentration / michiSelectedCount).toFixed(4))
        : 0;

    const coverage: EvaluationCoverageDto = {
      totalCandidates,
      candidatesWithConcentration,
      candidateCoverageRatio,
      baselineSelectedCount,
      baselineSelectedWithConcentration,
      baselineCoverageRatio,
      michiSelectedCount,
      michiSelectedWithConcentration,
      michiCoverageRatio,
    };

    const warnings = [
      ...parsed.warnings,
      ...(sources.length === 0
        ? [
            '연결된 관광 데이터가 없어 관광 지표는 데이터 없음으로 표시되고 Michi는 기본 품질 순서를 유지합니다.',
          ]
        : []),
      ...(sources.some((source) => source.mode === 'mock')
        ? ['MOCK 관광 데이터가 포함된 결과는 실제 성과가 아닙니다.']
        : []),
      ...(this.placeProvider.mode === 'mock'
        ? ['장소 후보에 명시적인 MOCK fixture가 포함되어 있습니다.']
        : []),
      ...(evidenceControlled.status === 'unavailable'
        ? [
            '관광 집중도와 취향 기준을 모두 충족한 후보가 없어 근거 통제 비교를 수행하지 못했습니다.',
          ]
        : evidenceControlled.status === 'partial'
          ? [
              `관광 근거 보유 후보 ${evidenceControlled.candidatePool.eligibleCandidates}곳만으로 제한된 근거 통제 비교입니다. 요청한 ${evidenceControlled.candidatePool.requestedSelectionCount}곳을 모두 채우지 못했습니다.`,
            ]
          : []),
      '이동 거리와 시간은 실제 길찾기가 아닌 직선거리·보행속도 기반 추정치입니다.',
    ];
    return {
      evaluationId: saved.id,
      generatedAt: saved.generatedAt.toISOString(),
      preference: { ...parsed.preference, area },
      dataMode: dataMode === 'unavailable' ? 'mock' : dataMode,
      baseline: {
        algorithmVersion: report.baseline.algorithmVersion,
        metrics: metricsDto(report.baseline),
        route: { stops: baselineRoute },
      },
      michi: {
        algorithmVersion: report.michi.algorithmVersion,
        metrics: metricsDto(report.michi),
        route: { stops: michiRoute },
      },
      delta: report.delta,
      expectedEffect: report.expectedEffect,
      evidenceControlledBenchmark: {
        algorithmVersion: evidenceControlled.algorithmVersion,
        status: evidenceControlled.status,
        candidatePool: { ...evidenceControlled.candidatePool },
        baseline: {
          algorithmVersion: evidenceControlled.evaluation.baseline.algorithmVersion,
          metrics: metricsDto(evidenceControlled.evaluation.baseline),
          route: { stops: evidenceControlledBaselineRoute },
        },
        michi: {
          algorithmVersion: evidenceControlled.evaluation.michi.algorithmVersion,
          metrics: metricsDto(evidenceControlled.evaluation.michi),
          route: { stops: evidenceControlledMichiRoute },
        },
        delta: evidenceControlled.evaluation.delta,
        expectedEffect: evidenceControlled.evaluation.expectedEffect,
      },
      coverage,
      dataSources: sources,
      warnings: [...new Set(warnings)],
    };
  }

  private routeFor(
    selected: readonly EvaluatedCandidate[],
    rankedById: ReadonlyMap<string, RankedCandidate>,
    travelDate: string,
    preference: { startTime: string; endTime: string; budget: number | null },
  ): EvaluationRouteStopDto[] {
    const candidates = selected.flatMap((entry) => {
      const candidate = rankedById.get(entry.id);
      return candidate
        ? [
            {
              ...candidate,
              scoreBreakdown: { ...candidate.scoreBreakdown, total: entry.algorithmScore },
            },
          ]
        : [];
    });
    const concentrationById = new Map(selected.map((entry) => [entry.id, entry.concentration]));
    return this.routeOptimizer
      .optimize({
        travelDate,
        startTime: preference.startTime,
        endTime: preference.endTime,
        budget: preference.budget,
        candidates,
      })
      .map((stop) => ({
        placeId: stop.placeId,
        placeName: rankedById.get(stop.placeId)?.place.name ?? stop.placeId,
        arrivalAt: this.seoulTime(new Date(stop.arrivalAt)),
        concentrationLevel: level(concentrationById.get(stop.placeId) ?? null),
      }));
  }

  private sourcesOf(candidates: readonly RankedCandidate[]): TourismSourceEvidence[] {
    const sources = new Map<string, TourismSourceEvidence>();
    for (const candidate of candidates) {
      for (const source of candidate.place.tourism?.sources ?? []) {
        sources.set(`${source.sourceRef}|${source.referencePeriod}|${source.mode}`, source);
      }
    }
    return [...sources.values()];
  }

  private dataModeOf(sources: readonly TourismSourceEvidence[]): TourismDataMode {
    const modes = new Set(sources.map((source) => source.mode));
    if (modes.size === 0) return 'unavailable';
    if (modes.size > 1) return 'mixed';
    return modes.has('live') ? 'live' : 'mock';
  }

  private overallDataMode(
    tourismMode: TourismDataMode,
    parserMode: 'live' | 'mock',
  ): TourismDataMode {
    if (tourismMode === 'unavailable') return 'mock';
    const modes = new Set<'live' | 'mock'>([
      parserMode,
      this.placeProvider.mode,
      ...(tourismMode === 'mixed' ? (['live', 'mock'] as const) : [tourismMode]),
    ]);
    return modes.size > 1 ? 'mixed' : modes.has('live') ? 'live' : 'mock';
  }

  private resolveTravelDate(explicit?: string): string {
    if (explicit) return explicit;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private seoulTime(value: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(value);
  }
}
