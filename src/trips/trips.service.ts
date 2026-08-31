import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ExternalDataSnapshot,
  Place,
  RecommendationResult,
  RecommendationScore,
  Trip,
  TripPreference,
  TripStop,
} from '../database/entities';
import { isNorthKoreaRelated } from '../common/utils/security-filter.util';
import { findVerifiedAirport } from '../common/constants/airports.registry';
import { PreferencesService } from '../preferences/preferences.service';
import type { DayTripPreference, ParsedTripPreference } from '../preferences/preference.types';
import {
  CROWD_PROVIDER,
  type CrowdObservation,
  type CrowdProvider,
} from '../providers/crowd/crowd-provider';
import { PlaceNormalizer } from '../providers/place/place-normalizer';
import { PLACE_PROVIDER, type PlaceProvider } from '../providers/place/place-provider';
import { PlaceCandidateSearchService } from '../providers/place/place-candidate-search.service';
import { PlaceDeduplicator } from '../providers/place/place-deduplicator';
import { seoulDistrictForArea } from '../providers/place/seoul-area-centers';
import { KtoPlaceProvider } from '../providers/place/kto-place.provider';
import { SeoulSpatialAreaService } from '../providers/place/seoul-spatial-area.service';
import { verifiedPlacePrice } from '../providers/place/place-price-evidence';
import { incompletePriceWarning } from './trip-price-coverage';
import { allowedPlaceSourcesForTrip } from './trip-place-source-policy';

export function completeRouteCost(route: Array<{ estimatedCost: number | null }>): number | null {
  if (route.length === 0 || route.some((stop) => stop.estimatedCost === null)) return null;
  return route.reduce((sum, stop) => sum + (stop.estimatedCost ?? 0), 0);
}
import {
  CANDIDATE_RANKER,
  ROUTE_OPTIMIZER,
  type CandidatePlace,
  type CandidateRanker,
  type RankCandidatesResult,
  type RankedCandidate,
  type RouteOptimizer,
} from '../recommendation/ports';
import { GenerateTripDto } from './dto/generate-trip.dto';
import { PatchTripStopsDto } from './dto/patch-trip-stops.dto';
import { PlaceSearchQueryGenerator } from './place-search-query-generator';
import {
  toTripDto,
  type SearchHotelItem,
  type StopAlternativesResponse,
  type TripApiResponse,
} from './trip-response';
import { TourismFeatureService } from '../tourism-feature/tourism-feature.service';
import {
  ITINERARY_EXPLANATION_PROVIDER,
  type ItineraryExplanationProvider,
} from '../ai/itinerary-explanation.types';
import {
  ROUTING_PROVIDER,
  type RequestedTransportMode,
  type RouteLegEstimate,
  type RoutingProvider,
} from '../routing/routing-provider';
import { PedestrianAccessibilityService } from '../routing/pedestrian-accessibility.service';
import type { AccessibilityLegEvidence } from '../routing/accessibility-evidence';
import { filterCandidatesForMealCuisine } from '../recommendation/cuisine-compatibility';
import { localizePlaceName } from './place-name-localizer';
import { PlaceDescriptionTranslationService } from '../place-details/place-description-translation.service';
import type { LocalizedPlaceDescription } from '../place-details/place-description-translation.service';
import { LogEvent, LogField } from '@logfriends/sdk';

function matchesPlaceName(query: string, placeName: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const n = placeName.toLowerCase().replace(/\s+/g, '');
  if (q.includes('리움') || q.includes('リウム') || q.includes('leeum')) {
    return n.includes('리움') || n.includes('leeum');
  }
  if (q.includes('서울숲')) {
    return n.includes('서울숲') || n.includes('seoulforest');
  }
  if (q.includes('경복궁')) {
    return n.includes('경복궁');
  }
  if (q.includes('서촌')) {
    return n.includes('서촌') || n.includes('통인') || n.includes('체부') || n.includes('옥인');
  }
  return n.includes(q) || q.includes(n);
}

export function isAreaConstraint(name: string, dayArea: string): boolean {
  const compact = (value: string): string =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/gu, '')
      .replace(/(?:동|구|일대)$/u, '');
  return compact(name) === compact(dayArea);
}

export function routeLegOverrides(
  route: Array<{ placeId: string }>,
  evidence: Array<RouteLegEstimate | null>,
): Record<string, RouteLegEstimate> {
  const result: Record<string, RouteLegEstimate> = {};
  for (let index = 1; index < route.length; index += 1) {
    const leg = evidence[index];
    if (leg?.evidence !== 'measured' && leg?.evidence !== 'mixed') continue;
    result[`${route[index - 1]!.placeId}->${route[index]!.placeId}`] = leg;
  }
  return result;
}

function sanitizeVerifiedDescription(raw: string, maxLength = 500): string | null {
  const stripped = raw
    .replace(/<[^>]*>/gu, '')
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&nbsp;/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (stripped.length === 0) return null;
  return stripped.length > maxLength ? `${stripped.slice(0, maxLength)}...` : stripped;
}

function extractVerifiedDescription(candidatePlace: CandidatePlace | undefined): string | null {
  const rawPayload = candidatePlace?.rawPayload;
  const sourceRecord = rawPayload?.sourceRecord as Record<string, unknown> | undefined;
  if (typeof sourceRecord?.description === 'string') {
    const sanitized = sanitizeVerifiedDescription(sourceRecord.description);
    if (sanitized) return sanitized;
  }
  if (typeof sourceRecord?.overview === 'string') {
    const sanitized = sanitizeVerifiedDescription(sourceRecord.overview);
    if (sanitized) return sanitized;
  }
  if (typeof rawPayload?.description === 'string') {
    const sanitized = sanitizeVerifiedDescription(rawPayload.description);
    if (sanitized) return sanitized;
  }
  return null;
}

export function placeAlternatives(name: string): string[] {
  const alternatives = name
    .split(/\s*(?:또는|혹은|or|\/|\|)\s*/iu)
    .map((value) => value.trim())
    .filter(Boolean);
  if (/리움|リウム|leeum/iu.test(name)) {
    alternatives.push('리움미술관', 'Leeum Museum');
  }
  if (/인천.*(?:공항|T1|1터미널)|incheon/iu.test(name)) {
    alternatives.push('인천국제공항 제1여객터미널', '인천공항 제1터미널', '인천국제공항');
  }
  if (/인천.*(?:T2|2터미널)/iu.test(name)) {
    alternatives.push('인천국제공항 제2여객터미널', '인천공항 제2터미널', '인천국제공항');
  }
  if (/김포.*공항|gimpo/iu.test(name)) {
    alternatives.push('김포국제공항', '김포공항 국내선', '김포공항');
  }
  if (/ロッテ|lotte/iu.test(name)) {
    if (/麻浦|マポ/iu.test(name)) alternatives.push('롯데시티호텔 마포');
    if (/明洞|ミョンドン/iu.test(name)) alternatives.push('롯데호텔 서울');
    alternatives.push('롯데호텔', '롯데시티호텔');
  }
  if (/新羅|シーラ|shilla/iu.test(name)) {
    alternatives.push('서울신라호텔', '신라호텔', '신라스테이');
  }
  if (/ナインツリー|nine\s*tree/iu.test(name)) {
    alternatives.push('나인트리 호텔', '나인트리 프리미어 호텔');
  }
  if (/ウェスティン|조선|chosun/iu.test(name)) {
    alternatives.push('웨스틴 조선 서울');
  }
  return [...new Set(alternatives)];
}

function anchorRoleForPlace(
  day: DayTripPreference,
  placeName: string,
): 'start' | 'intermediate' | 'destination' | null {
  if (day.startAnchor && matchesPlaceName(day.startAnchor.name, placeName)) return 'start';
  if (day.endAnchor && matchesPlaceName(day.endAnchor.name, placeName)) return 'destination';
  if (day.fixedAppointments?.some((item) => matchesPlaceName(item.name, placeName))) {
    return 'intermediate';
  }
  if (day.anchorPlace && matchesPlaceName(day.anchorPlace.name, placeName)) {
    return day.anchorPlace.role ?? 'destination';
  }
  if (day.mustVisitPlaces?.some((name) => matchesPlaceName(name, placeName))) {
    return 'intermediate';
  }
  return null;
}

@Injectable()
export class TripsService {
  constructor(
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    @InjectRepository(TripPreference)
    private readonly tripPreferences: Repository<TripPreference>,
    @InjectRepository(Place) private readonly places: Repository<Place>,
    @InjectRepository(TripStop) private readonly tripStops: Repository<TripStop>,
    @InjectRepository(RecommendationResult)
    private readonly results: Repository<RecommendationResult>,
    @InjectRepository(RecommendationScore)
    private readonly scores: Repository<RecommendationScore>,
    @InjectRepository(ExternalDataSnapshot)
    private readonly snapshots: Repository<ExternalDataSnapshot>,
    private readonly preferences: PreferencesService,
    private readonly queryGenerator: PlaceSearchQueryGenerator,
    private readonly normalizer: PlaceNormalizer,
    private readonly candidateSearch: PlaceCandidateSearchService,
    private readonly deduplicator: PlaceDeduplicator,
    private readonly spatialAreas: SeoulSpatialAreaService,
    private readonly ktoProvider: KtoPlaceProvider,
    @Inject(PLACE_PROVIDER) private readonly placeProvider: PlaceProvider,
    @Inject(CROWD_PROVIDER) private readonly crowdProvider: CrowdProvider,
    @Inject(CANDIDATE_RANKER) private readonly ranker: CandidateRanker,
    @Inject(ROUTE_OPTIMIZER) private readonly routeOptimizer: RouteOptimizer,
    private readonly tourismFeatures: TourismFeatureService,
    @Inject(ROUTING_PROVIDER) private readonly routingProvider: RoutingProvider,
    private readonly accessibility: PedestrianAccessibilityService,
    @Inject(ITINERARY_EXPLANATION_PROVIDER)
    private readonly explanationProvider: ItineraryExplanationProvider,
    private readonly placeDescriptionTranslations?: PlaceDescriptionTranslationService,
  ) {}

  @LogEvent({
    name: 'tripGenerated',
    description: '서울 여행 일정 생성 요청 처리',
    apiMethod: 'POST',
    apiPath: '/trips/generate',
    apiDescription: '여행 일정 생성',
    includeResult: false,
    includeDuration: true,
    includeArgs: false,
    fields: [
      { name: 'locale', description: '요청 언어', type: 'string', required: false },
      { name: 'textLength', description: '요청문 길이', type: 'number' },
      { name: 'hasBudget', description: '예산 입력 여부', type: 'boolean' },
      { name: 'hasDateRange', description: '여행 날짜 입력 여부', type: 'boolean' },
      { name: 'hasTimeWindow', description: '시작·종료 시간 입력 여부', type: 'boolean' },
    ],
    payload: (args) => {
      const dto = args[0] as GenerateTripDto;
      return {
        locale: dto?.locale,
        textLength: dto?.text?.length ?? 0,
        hasBudget: dto?.budget !== undefined,
        hasDateRange: Boolean(dto?.travelDate || dto?.startDate || dto?.endDate),
        hasTimeWindow: Boolean(dto?.startTime && dto?.endTime),
      };
    },
  })
  async generate(
    @LogField({ name: 'requestDto', description: '여행 생성 요청 조건 (지역, 날짜, 예산 등)' })
    dto: GenerateTripDto,
    incomingEditToken?: string,
  ): Promise<TripApiResponse> {
    const parsed = await this.preferences.parse(dto);
    const area = parsed.preference.area ?? dto.startArea;
    if (!area) {
      throw new BadRequestException({
        code: 'AREA_REQUIRED',
        message: '서울 내 여행 지역을 입력해 주세요.',
      });
    }
    const travelDate = this.resolveTravelDate(dto.travelDate, dto.text);
    const tripDays =
      parsed.preference.days && parsed.preference.days.length > 0
        ? parsed.preference.days
        : [
            {
              dayNumber: 1,
              date: travelDate,
              title: `${area} 하루 여행`,
              area,
              startTime: parsed.preference.startTime,
              endTime: parsed.preference.endTime,
              dailyBudgetKrw: parsed.preference.budget,
              startAnchor: null,
              endAnchor: null,
              fixedAppointments: [],
              mealWindows: [],
              mustVisitPlaces: [],
              interests: parsed.preference.interests,
              preferences: parsed.preference.preferences,
              avoid: parsed.preference.avoid,
              maxWalkMinutes: parsed.preference.maxWalkMinutes,
              anchorPlace: parsed.preference.anchorPlace,
            },
          ];

    const editToken = incomingEditToken || randomUUID();
    const trip = await this.trips.save(
      this.trips.create({
        status: 'generating',
        travelDate: tripDays[0]?.date ?? travelDate,
        startTime: tripDays[0]?.startTime ?? parsed.preference.startTime,
        endTime: tripDays[tripDays.length - 1]?.endTime ?? parsed.preference.endTime,
        budgetKrw: parsed.preference.totalBudgetKrw ?? parsed.preference.budget,
        startArea: area,
        providerMode: this.placeProvider.mode,
        totalEstimatedCost: null,
        editToken,
      }),
    );

    try {
      await this.tripPreferences.save(
        this.tripPreferences.create({
          tripId: trip.id,
          originalText: dto.text,
          area,
          startTime: tripDays[0]?.startTime ?? parsed.preference.startTime,
          endTime: tripDays[tripDays.length - 1]?.endTime ?? parsed.preference.endTime,
          budgetKrw: parsed.preference.totalBudgetKrw ?? parsed.preference.budget,
          companions: parsed.preference.companions ?? null,
          pace: parsed.preference.pace ?? null,
          interests: parsed.preference.interests,
          avoid: parsed.preference.avoid,
          preferences: parsed.preference.preferences,
          validatedJson: {
            ...parsed.preference,
            startDate: tripDays[0]?.date ?? travelDate,
            endDate: tripDays[tripDays.length - 1]?.date ?? travelDate,
            totalDays: tripDays.length,
            days: tripDays,
            area,
          },
          parserMode: parsed.parserMode,
        }),
      );

      const allSavedStops: TripStop[] = [];
      let globalOrder = 1;
      const allRankings: RankCandidatesResult[] = [];
      const allCrowds: CrowdObservation[] = [];
      const routeWarnings: string[] = [];
      const visitedPlaceIds = new Set<string>();

      for (const day of tripDays) {
        const dayArea = day.area ?? area;
        const dayDate = day.date ?? travelDate;
        const preferredTransit = parsed.preference.mobilityConstraint?.preferredTransit ?? null;
        const hasWalkingConstraint =
          day.avoid.some((tag) => /long_walk|walk|歩|걷|도보/.test(tag.toLowerCase())) ||
          (day.maxWalkMinutes !== null &&
            day.maxWalkMinutes !== undefined &&
            day.maxWalkMinutes <= 15);
        const searchRadiusMeters = hasWalkingConstraint ? 800 : 1_200;

        const dayPreference: ParsedTripPreference = {
          ...parsed.preference,
          ...day,
          area: dayArea,
          budget: day.dailyBudgetKrw ?? null,
        };

        const queries = this.queryGenerator.generate(dayPreference, Math.max(day.dayNumber - 1, 0));
        const nearestCrowdArea = await this.spatialAreas.nearestCrowdArea(dayArea);
        const [placeResponses, crowd, ktoCandidates] = await Promise.all([
          Promise.all(
            queries.map((query) => this.placeProvider.search({ query, area: dayArea, limit: 15 })),
          ),
          this.crowdProvider.getAreaCrowd(nearestCrowdArea?.areaName ?? dayArea),
          this.candidateSearch.searchKtoCandidates({
            area: dayArea,
            interests: day.interests,
            radiusMeters: searchRadiusMeters,
            limit: 40,
          }),
        ]);

        const records = placeResponses
          .flatMap((response) => response.places)
          .filter(
            (record, index, all) =>
              !isNorthKoreaRelated(record.name) &&
              !isNorthKoreaRelated(record.address) &&
              !isNorthKoreaRelated(record.roadAddress) &&
              !isNorthKoreaRelated(record.rawCategory) &&
              all.findIndex(
                (candidate) =>
                  candidate.provider === record.provider &&
                  candidate.sourcePlaceId === record.sourcePlaceId,
              ) === index,
          );
        const normalized = records.map((record) => this.normalizer.normalize(record));

        const persistedPlaces = await Promise.all(
          normalized.map(async (place) => {
            const existing = await this.places.findOneBy({
              source: place.source,
              sourcePlaceId: place.sourcePlaceId,
            });
            const retainedPrice = verifiedPlacePrice(
              existing?.estimatedCostKrw,
              existing?.priceEvidence,
            );
            return this.places.save(
              this.places.create({
                ...existing,
                ...place,
                estimatedCostKrw: retainedPrice?.estimatedCostKrw ?? null,
                priceEvidence: retainedPrice?.priceEvidence ?? null,
              }),
            );
          }),
        );
        const spatialFilter = await this.spatialAreas.filterPlaces(
          dayArea,
          persistedPlaces,
          searchRadiusMeters,
        );
        const crowdWithReference =
          crowd && nearestCrowdArea
            ? {
                ...crowd,
                requestedAreaName: dayArea,
                referenceDistanceMeters: nearestCrowdArea.distanceMeters,
                disclaimer: `${crowd.disclaimer} 요청 지역 ${dayArea}에서 약 ${nearestCrowdArea.distanceMeters}m 떨어진 인접 관측 지역의 참고값입니다.`,
              }
            : crowd;
        if (crowdWithReference) allCrowds.push(crowdWithReference);

        const anchorEntities: Place[] = [];
        const mandatoryPlaceNames = [
          ...(day.fixedAppointments?.map((a) => a.name) ?? []),
          ...(day.mustVisitPlaces ?? []),
        ].filter(
          (name, idx, arr) => name && !isAreaConstraint(name, dayArea) && arr.indexOf(name) === idx,
        );

        const targetAnchorNames = [
          ...(day.startAnchor ? [day.startAnchor.name] : []),
          ...mandatoryPlaceNames,
          ...(day.endAnchor ? [day.endAnchor.name] : []),
          ...(day.anchorPlace ? [day.anchorPlace.name] : []),
          ...(parsed.preference.baseCamp ? [parsed.preference.baseCamp.name] : []),
        ].filter(
          (name, idx, arr) => name && !isAreaConstraint(name, dayArea) && arr.indexOf(name) === idx,
        );

        for (const targetName of targetAnchorNames) {
          const isMandatory = mandatoryPlaceNames.includes(targetName);

          const verifiedAirport = findVerifiedAirport(targetName);
          if (verifiedAirport) {
            const existingAirport = await this.places.findOneBy({
              source: 'official_airport',
              sourcePlaceId: verifiedAirport.code,
            });
            const airportEntity = await this.places.save(
              this.places.create({
                ...existingAirport,
                source: 'official_airport',
                sourcePlaceId: verifiedAirport.code,
                name: verifiedAirport.nameKo,
                category: 'airport',
                rawCategory: '공항',
                address: verifiedAirport.address,
                roadAddress: verifiedAirport.roadAddress,
                district: verifiedAirport.code.startsWith('GMP') ? '강서구' : '중구',
                location: {
                  type: 'Point',
                  coordinates: [verifiedAirport.longitude, verifiedAirport.latitude],
                },
                rawPayload: {
                  officialAirport: true,
                  code: verifiedAirport.code,
                  iata: verifiedAirport.iata,
                  terminal: verifiedAirport.terminal,
                  transitSummaryKo: verifiedAirport.transitSummaryKo,
                  transitSummaryJa: verifiedAirport.transitSummaryJa,
                  transitLines: verifiedAirport.transitLines,
                },
              }),
            );
            anchorEntities.push(airportEntity);
            continue;
          }

          try {
            let validPlace = null;
            for (const alternative of placeAlternatives(targetName)) {
              for (const searchArea of [dayArea, '']) {
                const anchorSearchResult = await this.placeProvider.search({
                  query: alternative,
                  area: searchArea,
                  limit: 5,
                });
                validPlace =
                  anchorSearchResult.places.find((place) =>
                    matchesPlaceName(alternative, place.name),
                  ) ?? null;
                if (validPlace) break;
              }
              if (validPlace) break;
            }
            if (validPlace) {
              const normalizedAnchor = this.normalizer.normalize(validPlace);
              const existingAnchor = await this.places.findOneBy({
                source: normalizedAnchor.source,
                sourcePlaceId: normalizedAnchor.sourcePlaceId,
              });
              const savedAnchor = await this.places.save(
                this.places.create({ ...existingAnchor, ...normalizedAnchor }),
              );
              anchorEntities.push(savedAnchor);
            } else if (isMandatory) {
              throw new UnprocessableEntityException({
                code: 'MANDATORY_PLACE_NOT_FOUND',
                message: `필수 장소 또는 고정 예약 장소 '${targetName}'을(를) 정확하게 찾지 못했습니다.`,
              });
            }
          } catch (error) {
            if (error instanceof UnprocessableEntityException) throw error;
            if (isMandatory) {
              throw new UnprocessableEntityException({
                code: 'MANDATORY_PLACE_NOT_FOUND',
                message: `필수 장소 또는 고정 예약 장소 '${targetName}' 검색에 실패했습니다.`,
              });
            }
          }
        }

        const deduplicated = this.deduplicator.deduplicate([
          ...ktoCandidates,
          ...spatialFilter.places,
          ...anchorEntities,
        ]);

        const candidates: CandidatePlace[] = deduplicated.places.flatMap((place) => {
          if (!place.location) return [];
          const isAnchorPlace = anchorEntities.some((a) => a.id === place.id);
          const matchedAppt = day.fixedAppointments?.find((appointment) =>
            matchesPlaceName(appointment.name, place.name),
          );
          return [
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
              estimatedCostKrw: place.estimatedCostKrw ?? null,
              priceEvidence: place.priceEvidence ?? null,
              isAnchor: isAnchorPlace,
              anchorRole: isAnchorPlace ? anchorRoleForPlace(day, place.name) : null,
              fixedAppointment: Boolean(matchedAppt),
              targetTime: matchedAppt?.targetTime ?? null,
              estimatedStayMinutes: matchedAppt?.durationMinutes ?? 60,
            },
          ];
        });

        for (const anchorEntity of anchorEntities) {
          if (anchorEntity.location && !candidates.some((c) => c.placeId === anchorEntity.id)) {
            const matchedAppt = day.fixedAppointments?.find((appointment) =>
              matchesPlaceName(appointment.name, anchorEntity.name),
            );
            candidates.push({
              placeId: anchorEntity.id,
              source: anchorEntity.source,
              sourcePlaceId: anchorEntity.sourcePlaceId,
              name: anchorEntity.name,
              category: anchorEntity.category,
              address: anchorEntity.address,
              roadAddress: anchorEntity.roadAddress,
              location: anchorEntity.location,
              district: anchorEntity.district,
              rawCategory: anchorEntity.rawCategory,
              rawPayload: anchorEntity.rawPayload,
              estimatedCostKrw: anchorEntity.estimatedCostKrw ?? null,
              priceEvidence: anchorEntity.priceEvidence ?? null,
              isAnchor: true,
              anchorRole: anchorRoleForPlace(day, anchorEntity.name),
              fixedAppointment: Boolean(matchedAppt),
              targetTime: matchedAppt?.targetTime ?? null,
              estimatedStayMinutes: matchedAppt?.durationMinutes ?? 60,
            });
          }
        }

        if (candidates.length === 0) {
          throw new UnprocessableEntityException({
            code: 'NO_FEASIBLE_ROUTE',
            message: `Day ${day.dayNumber} (${dayArea})에 가능한 여행 장소 후보가 없습니다.`,
          });
        }

        const repeatablePlaceIds = new Set(
          candidates
            .filter((candidate) => candidate.isAnchor || candidate.fixedAppointment)
            .map((candidate) => candidate.placeId),
        );
        const uniqueDayCandidates = candidates.filter(
          (candidate) =>
            !visitedPlaceIds.has(candidate.placeId) || repeatablePlaceIds.has(candidate.placeId),
        );
        const excludedVisitedCount = candidates.length - uniqueDayCandidates.length;
        if (excludedVisitedCount > 0) {
          routeWarnings.push(
            `Day ${day.dayNumber}: 앞선 날짜에 방문한 장소 후보 ${excludedVisitedCount}곳을 제외했습니다.`,
          );
        }
        if (uniqueDayCandidates.length === 0) {
          throw new UnprocessableEntityException({
            code: 'NO_UNIQUE_PLACE_CANDIDATES',
            message: `Day ${day.dayNumber} (${dayArea})에 앞선 날짜와 겹치지 않는 장소 후보가 없습니다.`,
          });
        }

        const tourismByPlace = await this.tourismFeatures.forPlaces(
          uniqueDayCandidates,
          [dayArea, seoulDistrictForArea(dayArea)].filter((value): value is string =>
            Boolean(value),
          ),
          dayDate,
        );
        const enrichedCandidates = uniqueDayCandidates.map((candidate) => ({
          ...candidate,
          tourism: tourismByPlace.get(candidate.placeId),
        }));

        const ranking = this.ranker.rank({
          preference: dayPreference,
          places: enrichedCandidates,
          crowd: crowdWithReference,
          locale: dto.locale,
        });
        allRankings.push(ranking);

        const eligibleCandidates =
          day.interests.length > 0
            ? ranking.candidates.filter(
                (candidate) =>
                  candidate.isAnchor ||
                  candidate.scoreBreakdown.preference >= 0.5 ||
                  ((day.mealWindows?.length ?? 0) > 0 && candidate.place.category === 'restaurant'),
              )
            : ranking.candidates;

        const cuisineFilter = filterCandidatesForMealCuisine(
          eligibleCandidates,
          day.mealWindows ?? [],
        );
        if ((day.mealWindows?.length ?? 0) > 0 && cuisineFilter.matchedRestaurantCount === 0) {
          throw new UnprocessableEntityException({
            code: 'MEAL_CUISINE_NOT_FOUND',
            message: `Day ${day.dayNumber} (${dayArea})에서 요청한 음식 종류와 확인 가능한 정보가 일치하는 식당을 찾지 못했습니다.`,
          });
        }
        if (cuisineFilter.excludedRestaurantCount > 0) {
          routeWarnings.push(
            `Day ${day.dayNumber}: 요청한 음식 종류와 상충하거나 확인되지 않은 식당 후보 ${cuisineFilter.excludedRestaurantCount}개를 제외했습니다.`,
          );
        }

        const primaryAnchor = uniqueDayCandidates.find(
          (candidate) =>
            candidate.isAnchor &&
            !candidate.fixedAppointment &&
            candidate.anchorRole === 'destination',
        );
        const dayCandidates =
          cuisineFilter.candidates.length > 0 ? cuisineFilter.candidates : ranking.candidates;
        const routeInput = {
          travelDate: dayDate,
          startTime: day.startTime,
          endTime: day.endTime,
          budget: day.dailyBudgetKrw ?? null,
          candidates: dayCandidates,
          maxWalkMinutes:
            preferredTransit === null || preferredTransit === 'walk'
              ? (day.maxWalkMinutes ?? (hasWalkingConstraint ? 15 : null))
              : null,
          maxWalkDistanceKm:
            hasWalkingConstraint && (preferredTransit === null || preferredTransit === 'walk')
              ? 0.8
              : null,
          anchorPlaceId: primaryAnchor?.placeId ?? null,
          anchorTargetTime:
            day.fixedAppointments?.[0]?.targetTime ?? day.anchorPlace?.targetTime ?? null,
          anchorRole: primaryAnchor?.anchorRole ?? (primaryAnchor ? 'destination' : null),
          mealWindows: day.mealWindows,
          fixedAppointments: day.fixedAppointments,
        };
        let routeCandidates = dayCandidates;
        let route = this.routeOptimizer.optimize(routeInput);

        if (route.length === 0) {
          throw new UnprocessableEntityException({
            code: 'NO_FEASIBLE_ROUTE',
            message: `Day ${day.dayNumber} (${dayArea})에 제약 조건을 만족하는 이동 경로를 생성하지 못했습니다.`,
          });
        }

        let legEvidence = await this.collectLegEvidence(
          route,
          routeCandidates,
          parsed.preference.mobilityConstraint?.preferredTransit ?? null,
          day.date ?? undefined,
          {
            maxWalkMinutes:
              day.maxWalkMinutes ??
              parsed.preference.mobilityConstraint?.maxWalkMinutesPerLeg ??
              null,
            allowShortWalkSubstitution:
              !parsed.preference.mobilityConstraint?.avoidSteepInclineOrStairs,
          },
        );
        routeWarnings.push(...legEvidence.warnings);
        if (day.maxWalkMinutes && (preferredTransit === 'subway' || preferredTransit === 'bus')) {
          routeWarnings.push(
            '대중교통 승하차 전후의 실제 보행시간 API가 없어 최대 도보시간은 전체 장소 간 거리 제한으로 잘못 적용하지 않았습니다.',
          );
        }

        if (parsed.preference.mobilityConstraint?.avoidSteepInclineOrStairs) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const riskyIndex = legEvidence.accessibility.findIndex(
              (evidence, index) =>
                index > 0 &&
                evidence !== null &&
                evidence.status === 'checked' &&
                evidence.risk !== 'none-detected',
            );
            if (riskyIndex < 0) break;
            const riskyStop = route[riskyIndex];
            if (!riskyStop || riskyStop.stopType !== 'general') {
              routeWarnings.push(
                '필수·예약·식사 경유지로 향하는 구간에서 경사 또는 계단 위험이 감지되어 자동 삭제하지 않았습니다.',
              );
              break;
            }
            routeCandidates = routeCandidates.filter(
              (candidate) => candidate.place.placeId !== riskyStop.placeId,
            );
            const alternative = this.routeOptimizer.optimize({
              ...routeInput,
              candidates: routeCandidates,
            });
            if (alternative.length === 0) break;
            route = alternative;
            legEvidence = await this.collectLegEvidence(
              route,
              routeCandidates,
              parsed.preference.mobilityConstraint.preferredTransit ?? null,
              day.date ?? undefined,
              {
                maxWalkMinutes:
                  day.maxWalkMinutes ??
                  parsed.preference.mobilityConstraint.maxWalkMinutesPerLeg ??
                  null,
                allowShortWalkSubstitution:
                  !parsed.preference.mobilityConstraint.avoidSteepInclineOrStairs,
              },
            );
            routeWarnings.push(
              `경사·계단 GIS 위험 구간을 피하기 위해 일반 경유지 1곳을 제외하고 일정을 다시 계산했습니다.`,
              ...legEvidence.warnings,
            );
          }
        }

        const evidenceOverrides = routeLegOverrides(route, legEvidence.routes);
        if (Object.keys(evidenceOverrides).length > 0) {
          const orderedCandidates = route.flatMap((stop) => {
            const candidate = routeCandidates.find((item) => item.place.placeId === stop.placeId);
            return candidate ? [candidate] : [];
          });
          const measuredRoute = this.routeOptimizer.optimize({
            ...routeInput,
            candidates: orderedCandidates,
            preserveOrder: true,
            legEstimates: evidenceOverrides,
          });
          if (measuredRoute.length !== route.length) {
            throw new UnprocessableEntityException({
              code: 'ROUTE_EVIDENCE_INFEASIBLE',
              message: `Day ${day.dayNumber} (${dayArea})의 공식 이동시간을 반영하면 요청 시간 안에 일정을 완료할 수 없습니다.`,
            });
          }
          route = measuredRoute;
        }

        const indoorFallbacks = uniqueDayCandidates.filter(
          (c) => c.category === 'museum' || c.category === 'cafe',
        );

        const unexpectedRepeatedStop = route.find(
          (item) => visitedPlaceIds.has(item.placeId) && !repeatablePlaceIds.has(item.placeId),
        );
        if (unexpectedRepeatedStop) {
          throw new UnprocessableEntityException({
            code: 'DUPLICATE_PLACE_ACROSS_DAYS',
            message: `Day ${day.dayNumber} (${dayArea}) 일정에 앞선 날짜와 동일한 장소가 포함되었습니다.`,
          });
        }

        const dayStops = route.map((item, routeIndex) => {
          const ranked = ranking.candidates.find(
            (candidate) => candidate.place.placeId === item.placeId,
          );
          const breakdown = ranked?.scoreBreakdown ?? {
            total: 0,
            preference: 0,
            crowd: 0,
            distance: 0,
            time: 0,
            budget: 0,
            tourismDispersion:
              ranked?.place.tourism?.concentration?.concentration != null
                ? 1 - ranked.place.tourism.concentration.concentration
                : null,
            localImpact: null,
          };

          const isOutdoor =
            ranked?.place.category === 'park' ||
            ranked?.place.category === 'culture' ||
            /궁|숲|공원|거리|야외/i.test(ranked?.place.rawCategory ?? '');

          const rainFallbackPlaceId =
            parsed.preference.rainFallbackPolicy === 'indoor_switch' && isOutdoor
              ? (indoorFallbacks.find((fb) => fb.placeId !== item.placeId)?.placeId ?? null)
              : null;

          return this.tripStops.create({
            tripId: trip.id,
            placeId: item.placeId,
            order: globalOrder++,
            stopType: item.stopType ?? 'general',
            rainFallbackPlaceId,
            arrivalAt: new Date(item.arrivalAt),
            leaveAt: new Date(item.leaveAt),
            estimatedStayMinutes: item.estimatedStayMinutes,
            estimatedCost: item.estimatedCost,
            reason: ranked?.reason ?? item.reason,
            crowdContext: crowdWithReference
              ? {
                  provider: crowdWithReference.provider,
                  providerMode: crowdWithReference.providerMode,
                  scope: 'area',
                  areaName: crowdWithReference.areaName,
                  congestionLevel: crowdWithReference.congestionLevel,
                  observedAt: crowdWithReference.observedAt,
                  disclaimer: crowdWithReference.disclaimer,
                  requestedAreaName: crowdWithReference.requestedAreaName,
                  referenceDistanceMeters: crowdWithReference.referenceDistanceMeters,
                }
              : null,
            scoreBreakdown: breakdown,
            tourismEvidence: ranked?.place.tourism ?? null,
            inboundRoute: legEvidence.routes[routeIndex] ?? null,
            accessibilityContext: legEvidence.accessibility[routeIndex] ?? null,
          });
        });

        for (const stop of route) visitedPlaceIds.add(stop.placeId);
        allSavedStops.push(...dayStops);
      }

      if (allSavedStops.length === 0) {
        throw new UnprocessableEntityException({
          code: 'NO_FEASIBLE_ROUTE',
          message: '입력한 조건으로 가능한 여행 일정을 생성하지 못했습니다.',
        });
      }

      // Generate contextual explanation for the full trip and each stop in 1 single call
      const explanationLocale: 'ko' | 'ja' =
        dto.locale === 'ko' || dto.locale === 'ja'
          ? dto.locale
          : /[가-힣]/u.test(dto.text)
            ? 'ko'
            : 'ja';

      const allCandidatesMap = new Map<string, CandidatePlace>();
      for (const ranking of allRankings) {
        for (const candidate of ranking.candidates) {
          allCandidatesMap.set(candidate.place.placeId, candidate.place);
        }
      }

      // 실제 Provider에서 새로 확인한 장소는 설명 ko/ja가 DB에 모두 있을 때만 재사용한다.
      // 없는 경우에만 최종 경유지에 한정해 장소당 웹 검색 1회로 두 언어를 함께 저장한다.
      // 후보 전체에 호출하지 않아 추천 생성 비용과 지연을 제한한다.
      const descriptionsByPlace: Map<string, Record<'ko' | 'ja', LocalizedPlaceDescription>> = this
        .placeDescriptionTranslations
        ? await this.placeDescriptionTranslations.ensureForPlaces(
            await this.places.findBy({
              id: In([...new Set(allSavedStops.map((stop) => stop.placeId))]),
            }),
          )
        : new Map<string, Record<'ko' | 'ja', LocalizedPlaceDescription>>();

      const explanationInputStops = allSavedStops.map((stop, index) => {
        const candidatePlace = allCandidatesMap.get(stop.placeId);
        const nextStop = index < allSavedStops.length - 1 ? allSavedStops[index + 1] : undefined;
        const nextLeg = nextStop?.inboundRoute ?? null;
        const stopDate = seoulDateString(stop.arrivalAt);

        let dayNumber = 1;
        try {
          const diffDays = Math.floor(
            (new Date(stopDate).getTime() - new Date(travelDate).getTime()) / (1000 * 60 * 60 * 24),
          );
          dayNumber = diffDays >= 0 ? diffDays + 1 : 1;
        } catch {
          dayNumber = 1;
        }

        return {
          order: stop.order,
          dayNumber,
          dayDate: stopDate,
          placeId: stop.placeId,
          placeName: localizePlaceName(candidatePlace?.name ?? stop.placeId, explanationLocale),
          category: candidatePlace?.category ?? null,
          rawCategory: candidatePlace?.rawCategory ?? null,
          address: candidatePlace?.roadAddress ?? candidatePlace?.address ?? null,
          district: candidatePlace?.district ?? null,
          stopType: stop.stopType ?? 'general',
          arrivalAt: seoulTimeString(stop.arrivalAt),
          leaveAt: seoulTimeString(stop.leaveAt),
          estimatedStayMinutes: stop.estimatedStayMinutes,
          estimatedCost: stop.estimatedCost,
          reason: stop.reason,
          scoreBreakdown: stop.scoreBreakdown as unknown as Record<
            string,
            number | null | undefined
          >,
          crowdContext: stop.crowdContext
            ? {
                areaName: stop.crowdContext.areaName,
                congestionLevel: stop.crowdContext.congestionLevel,
                scope: 'area' as const,
              }
            : null,
          inboundRoute: stop.inboundRoute
            ? {
                durationMinutes: stop.inboundRoute.durationMinutes,
                distanceKm: stop.inboundRoute.distanceKm,
                transportMode: stop.inboundRoute.transportMode,
                evidence: stop.inboundRoute.evidence,
              }
            : null,
          nextLegRoute: nextLeg
            ? {
                durationMinutes: nextLeg.durationMinutes,
                distanceKm: nextLeg.distanceKm,
                transportMode: nextLeg.transportMode,
                evidence: nextLeg.evidence,
              }
            : null,
          tourismEvidence: stop.tourismEvidence
            ? {
                concentration: {
                  level:
                    stop.tourismEvidence.concentration.concentration != null
                      ? stop.tourismEvidence.concentration.concentration < 1 / 3
                        ? 'low'
                        : stop.tourismEvidence.concentration.concentration < 2 / 3
                          ? 'medium'
                          : 'high'
                      : 'unavailable',
                  referencePeriod: stop.tourismEvidence.referencePeriod,
                  areaName: stop.tourismEvidence.areaName,
                },
                sourceRef: stop.tourismEvidence.sources.map((s) => s.sourceRef).join(', '),
              }
            : null,
          verifiedDescription:
            descriptionsByPlace.get(stop.placeId)?.[explanationLocale]?.text ??
            extractVerifiedDescription(candidatePlace),
        };
      });

      const explanationResult = await this.explanationProvider.generate({
        locale: explanationLocale,
        preference: {
          area: parsed.preference.area,
          startDate: parsed.preference.startDate,
          endDate: parsed.preference.endDate,
          totalDays: tripDays.length,
          startTime: parsed.preference.startTime,
          endTime: parsed.preference.endTime,
          budget: parsed.preference.budget,
          partySize: parsed.preference.partySize,
          companions: parsed.preference.companions,
          interests: parsed.preference.interests ?? [],
          preferences: parsed.preference.preferences ?? [],
          avoid: parsed.preference.avoid ?? [],
        },
        stops: explanationInputStops,
      });

      for (const stop of allSavedStops) {
        const exp = explanationResult.stops.find(
          (e) => e.order === stop.order && e.placeId === stop.placeId,
        );
        if (exp) {
          stop.explanation = {
            shortDescription: exp.shortDescription,
            previousStopFit: exp.previousStopFit,
            nextStopFit: exp.nextStopFit,
            overallTripFit: exp.overallTripFit,
          };
        }
      }

      const savedStops = await this.tripStops.save(allSavedStops);

      const latestRanking = allRankings[allRankings.length - 1];
      const finalWeights: Record<string, number> = latestRanking?.weights
        ? { ...(latestRanking.weights as unknown as Record<string, number>) }
        : {};
      const bestCandidateByPlace = new Map<string, RankedCandidate>();
      for (const ranking of allRankings) {
        for (const candidate of ranking.candidates) {
          const previous = bestCandidateByPlace.get(candidate.place.placeId);
          if (!previous || candidate.scoreBreakdown.total > previous.scoreBreakdown.total) {
            bestCandidateByPlace.set(candidate.place.placeId, candidate);
          }
        }
      }
      const uniqueCandidates = [...bestCandidateByPlace.values()];
      const result = await this.results.save(
        this.results.create({
          tripId: trip.id,
          algorithmVersion: latestRanking?.algorithmVersion ?? 'deterministic-ranker-v1',
          finalWeights,
          candidateCount: uniqueCandidates.length,
          explanation: {
            tripSummary: explanationResult.tripSummary,
            locale: explanationResult.locale,
            mode: explanationResult.mode,
            model: explanationResult.model,
            generatedAt: explanationResult.generatedAt,
          },
        }),
      );

      if (uniqueCandidates.length > 0) {
        await this.scores.save(
          uniqueCandidates.map((candidate) =>
            this.scores.create({
              resultId: result.id,
              placeId: candidate.place.placeId,
              total: candidate.scoreBreakdown.total,
              preference: candidate.scoreBreakdown.preference,
              crowd: candidate.scoreBreakdown.crowd,
              distance: candidate.scoreBreakdown.distance,
              time: candidate.scoreBreakdown.time,
              budget: candidate.scoreBreakdown.budget,
              diversity: candidate.scoreBreakdown.diversity,
              area: candidate.scoreBreakdown.area,
              featureBreakdown: {
                tourismDispersion: candidate.scoreBreakdown.tourismDispersion,
                localImpact: candidate.scoreBreakdown.localImpact,
              },
              featureLineage:
                candidate.place.tourism?.sources.map((source) => ({ ...source })) ?? [],
            }),
          ),
        );
      }

      for (const crowd of allCrowds) {
        await this.snapshots.save(
          this.snapshots.create({
            provider: crowd.provider,
            dataKind: 'crowd',
            scope: 'area',
            scopeReference: crowd.areaName,
            sourceTimestamp: crowd.observedAt ? new Date(crowd.observedAt) : null,
            sourceUrl: crowd.sourceUrl,
            rawPayload: crowd.rawPayload,
          }),
        );
      }

      const totalEstimatedCost = completeRouteCost(savedStops);
      trip.status = 'ready';
      trip.totalEstimatedCost = totalEstimatedCost;
      await this.trips.save(trip);

      const loadedTrip = await this.loadTrip(trip.id);

      const warnings: string[] = [...routeWarnings];
      if (parsed.preference.mobilityConstraint?.avoidSteepInclineOrStairs) {
        const checked = savedStops.some((stop) => stop.accessibilityContext?.status === 'checked');
        warnings.push(
          checked
            ? '경사·계단 회피는 적재된 서울시 GIS와 장소 간 직선 회랑을 이용한 보수적 검사이며 실제 무장애 보행 경로 보장은 아닙니다.'
            : '서울시 경사도·계단 GIS가 적재되지 않아 해당 이동 제약은 검사하지 못했습니다.',
        );
      }
      if (tripDays.length > 1) {
        warnings.push(`총 ${tripDays.length}일간의 날짜별 맞춤 일정이 생성되었습니다.`);
      }
      return this.responseFor(loadedTrip, [...warnings, ...parsed.warnings], editToken, true);
    } catch (error) {
      trip.status = 'failed';
      await this.trips.save(trip);
      throw error;
    }
  }

  async get(id: string, editToken?: string): Promise<TripApiResponse> {
    return this.responseFor(await this.loadTrip(id), [], editToken);
  }

  @LogEvent({
    name: 'tripModified',
    description: '여행 경유지 삭제/순서변경/재계산 수정',
    apiMethod: 'PATCH',
    apiPath: '/trips/{id}/stops',
    apiDescription: '여행 경유지 수정',
    includeResult: false,
    includeDuration: true,
    includeArgs: false,
    fields: [
      { name: 'tripId', description: '수정 대상 여행 식별자', type: 'string' },
      { name: 'action', description: '수정 작업 종류', type: 'string' },
      { name: 'stopCount', description: '순서 변경 시 경유지 수', type: 'number', required: false },
    ],
    payload: (args) => {
      const dto = args[1] as PatchTripStopsDto;
      return { tripId: args[0], action: dto?.action, stopCount: dto?.stopIds?.length };
    },
  })
  async patchStops(
    @LogField({ name: 'tripId', description: '수정 대상 여행 ID' })
    id: string,
    @LogField({ name: 'patchDto', description: '경유지 변경 작업 (remove/reorder/recalculate)' })
    dto: PatchTripStopsDto,
    editToken?: string,
  ): Promise<TripApiResponse> {
    const trip = await this.loadTrip(id);
    if (!trip.editToken || !editToken || trip.editToken !== editToken) {
      throw new ForbiddenException({
        code: 'TRIP_EDIT_FORBIDDEN',
        message: 'You do not have permission to modify this trip.',
      });
    }
    const currentStops = [...trip.stops].sort((a, b) => a.order - b.order);
    let proposedStops: TripStop[];
    let removedStopId: string | undefined;
    if (dto.action === 'remove') {
      if (!dto.stopId) {
        throw this.invalidAction('stopId is required for remove');
      }
      const stop = currentStops.find((candidate) => candidate.id === dto.stopId);
      if (!stop) throw new NotFoundException({ code: 'STOP_NOT_FOUND', message: 'Stop not found' });
      removedStopId = stop.id;
      proposedStops = currentStops.filter((candidate) => candidate.id !== stop.id);
    } else if (dto.action === 'reorder') {
      if (!dto.stopIds || dto.stopIds.length !== currentStops.length) {
        throw this.invalidAction('stopIds must include every current stop exactly once');
      }
      const expected = new Set(currentStops.map((stop) => stop.id));
      if (
        new Set(dto.stopIds).size !== expected.size ||
        dto.stopIds.some((stopId) => !expected.has(stopId))
      ) {
        throw this.invalidAction('stopIds must include every current stop exactly once');
      }
      const stopById = new Map(currentStops.map((stop) => [stop.id, stop]));
      proposedStops = dto.stopIds.map((stopId) => stopById.get(stopId)!);
    } else if (dto.action === 'replace') {
      if (!dto.stopId || !dto.newPlaceId) {
        throw this.invalidAction('stopId and newPlaceId are required for replace');
      }
      const stopIndex = currentStops.findIndex((candidate) => candidate.id === dto.stopId);
      if (stopIndex === -1) {
        throw new NotFoundException({ code: 'STOP_NOT_FOUND', message: 'Stop not found' });
      }
      const newPlace = await this.places.findOneBy({ id: dto.newPlaceId });
      if (!newPlace) {
        throw new NotFoundException({ code: 'PLACE_NOT_FOUND', message: 'New place not found' });
      }
      const allowedSources = allowedPlaceSourcesForTrip(
        trip.providerMode,
        this.placeProvider.name,
        this.ktoProvider.name,
        currentStops.map((candidate) => candidate.place.source),
      );
      if (!allowedSources.includes(newPlace.source)) {
        throw new BadRequestException({
          code: 'PLACE_SOURCE_NOT_ALLOWED',
          message: '현재 일정의 데이터 모드와 다른 출처의 장소로 교체할 수 없습니다.',
        });
      }
      const oldStop = currentStops[stopIndex]!;
      const replacementPrice = verifiedPlacePrice(
        newPlace.estimatedCostKrw,
        newPlace.priceEvidence,
      );
      const replacedStop: TripStop = {
        ...oldStop,
        placeId: newPlace.id,
        place: newPlace,
        estimatedCost: replacementPrice?.estimatedCostKrw ?? null,
        reason: `대체 장소 교체: ${newPlace.name}`,
      };
      proposedStops = [...currentStops];
      proposedStops[stopIndex] = replacedStop;
    } else {
      proposedStops = currentStops;
    }
    const candidates: RankedCandidate[] = proposedStops.map((stop) => ({
      place: {
        placeId: stop.place.id,
        source: stop.place.source,
        sourcePlaceId: stop.place.sourcePlaceId,
        name: stop.place.name,
        category: stop.place.category,
        address: stop.place.address,
        roadAddress: stop.place.roadAddress,
        location: stop.place.location,
        district: stop.place.district,
        rawCategory: stop.place.rawCategory,
        rawPayload: stop.place.rawPayload,
        ...(stop.tourismEvidence ? { tourism: stop.tourismEvidence } : {}),
      },
      estimatedCost: stop.estimatedCost,
      estimatedStayMinutes: stop.estimatedStayMinutes,
      reason: stop.reason,
      scoreBreakdown: {
        ...stop.scoreBreakdown,
        tourismDispersion: stop.scoreBreakdown.tourismDispersion ?? null,
        localImpact: stop.scoreBreakdown.localImpact ?? null,
      },
    }));
    const editRouteInput = {
      travelDate: trip.travelDate,
      startTime: trip.startTime.slice(0, 5),
      endTime: trip.endTime.slice(0, 5),
      budget: trip.budgetKrw,
      candidates,
      preserveOrder: true,
    };
    let route = this.routeOptimizer.optimize(editRouteInput);
    const proposedPlaceIds = proposedStops.map((stop) => stop.placeId);
    const routePlaceIds = route.map((stop) => stop.placeId);
    if (
      route.length !== proposedStops.length ||
      routePlaceIds.some((placeId, index) => placeId !== proposedPlaceIds[index])
    ) {
      throw new UnprocessableEntityException({
        code: 'EDIT_ROUTE_INFEASIBLE',
        message: '편집한 순서를 유지하면서 시간·예산 제약을 만족할 수 없습니다.',
      });
    }
    const mobility = trip.preference.validatedJson.mobilityConstraint as
      | {
          preferredTransit?: RequestedTransportMode;
          maxWalkMinutesPerLeg?: number;
          avoidSteepInclineOrStairs?: boolean;
        }
      | null
      | undefined;
    const legEvidence = await this.collectLegEvidence(
      route,
      candidates,
      mobility?.preferredTransit ?? null,
      trip.travelDate,
      {
        maxWalkMinutes: mobility?.maxWalkMinutesPerLeg ?? null,
        allowShortWalkSubstitution: !mobility?.avoidSteepInclineOrStairs,
      },
    );
    const evidenceOverrides = routeLegOverrides(route, legEvidence.routes);
    if (Object.keys(evidenceOverrides).length > 0) {
      const measuredRoute = this.routeOptimizer.optimize({
        ...editRouteInput,
        legEstimates: evidenceOverrides,
      });
      if (measuredRoute.length !== route.length) {
        throw new UnprocessableEntityException({
          code: 'EDIT_ROUTE_EVIDENCE_INFEASIBLE',
          message: '공식 이동시간을 반영하면 편집한 일정을 요청 시간 안에 완료할 수 없습니다.',
        });
      }
      route = measuredRoute;
    }
    const stopByPlace = new Map(proposedStops.map((stop) => [stop.placeId, stop]));
    await this.tripStops.manager.transaction(async (manager) => {
      if (removedStopId) {
        await manager.delete(TripStop, { id: removedStopId, tripId: trip.id });
      }
      await manager
        .createQueryBuilder()
        .update(TripStop)
        .set({ order: () => '"order" + 1000' })
        .where('trip_id = :tripId', { tripId: trip.id })
        .execute();
      for (const [routeIndex, plan] of route.entries()) {
        const stop = stopByPlace.get(plan.placeId);
        if (!stop) continue;
        await manager.update(TripStop, stop.id, {
          order: plan.order,
          placeId: stop.placeId,
          estimatedCost: stop.estimatedCost,
          reason: stop.reason,
          arrivalAt: new Date(plan.arrivalAt),
          leaveAt: new Date(plan.leaveAt),
          inboundRoute: legEvidence.routes[routeIndex] ?? null,
          accessibilityContext: legEvidence.accessibility[routeIndex] ?? null,
        });
      }
      await manager.update(Trip, trip.id, {
        totalEstimatedCost: completeRouteCost(route),
        status: 'modified',
      });
    });
    return this.responseFor(
      await this.loadTrip(id),
      ['일정 편집 후 이동 시간과 방문 시간을 다시 계산했습니다.', ...legEvidence.warnings],
      editToken,
    );
  }

  private invalidAction(message: string): BadRequestException {
    return new BadRequestException({ code: 'INVALID_STOP_ACTION', message });
  }

  private resolveTravelDate(explicit: string | undefined, text: string): string {
    if (explicit) return explicit;
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const today = formatter.format(new Date());
    if (!/明日|내일/.test(text)) return today;
    const tomorrow = new Date(`${today}T12:00:00+09:00`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return formatter.format(tomorrow);
  }

  private async collectLegEvidence(
    route: Array<{ placeId: string; leaveAt?: string }>,
    candidates: RankedCandidate[],
    requestedMode: RequestedTransportMode,
    travelDate?: string,
    mobilityOptions?: {
      maxWalkMinutes: number | null;
      allowShortWalkSubstitution: boolean;
    },
  ): Promise<{
    routes: Array<RouteLegEstimate | null>;
    accessibility: Array<AccessibilityLegEvidence | null>;
    warnings: string[];
  }> {
    const byId = new Map(candidates.map((candidate) => [candidate.place.placeId, candidate]));
    const routes: Array<RouteLegEstimate | null> = [null];
    const accessibility: Array<AccessibilityLegEvidence | null> = [null];
    const warnings: string[] = [];
    for (let index = 1; index < route.length; index += 1) {
      const origin = byId.get(route[index - 1]!.placeId)?.place.location ?? null;
      const destination = byId.get(route[index]!.placeId)?.place.location ?? null;
      const departureTime = route[index - 1]?.leaveAt;
      try {
        routes.push(
          await this.routingProvider.measureLeg(origin, destination, requestedMode, {
            travelDate,
            departureTime,
            maxWalkMinutes: mobilityOptions?.maxWalkMinutes,
            allowShortWalkSubstitution: mobilityOptions?.allowShortWalkSubstitution,
          }),
        );
      } catch (error) {
        routes.push({
          ...this.routingProvider.planningEstimate(origin, destination),
          requestedTransportMode: requestedMode,
        });
        warnings.push(
          `실측 길찾기 호출에 실패해 해당 구간은 추정값을 사용했습니다: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      accessibility.push(await this.accessibility.evaluateLeg(origin, destination));
    }
    return { routes, accessibility, warnings };
  }

  private async loadTrip(id: string): Promise<Trip> {
    const trip = await this.trips.findOne({
      where: { id },
      relations: {
        preference: true,
        stops: { place: { descriptionTranslations: true } },
        recommendationResult: { scores: true },
      },
    });
    if (!trip) {
      throw new NotFoundException({ code: 'TRIP_NOT_FOUND', message: 'Trip not found' });
    }
    return trip;
  }

  private responseFor(
    trip: Trip,
    warnings: string[],
    editToken?: string,
    isGeneration = false,
  ): TripApiResponse {
    const preferenceJson = trip.preference?.validatedJson ?? {};
    const locale: 'ko' | 'ja' =
      trip.recommendationResult?.explanation?.locale === 'ko' || preferenceJson.locale === 'ko'
        ? 'ko'
        : 'ja';
    const priceWarning = incompletePriceWarning(trip.stops ?? [], locale);
    const tourismMode = this.tripTourismMode(trip);
    const tourismWarning =
      tourismMode === 'unavailable'
        ? locale === 'ja'
          ? 'この旅程には韓国観光データラボの根拠が紐づいていないため、観光分散効果は表示しません。'
          : '이 일정에는 한국관광 데이터랩 근거가 연결되지 않아 관광 분산 효과를 표시하지 않습니다.'
        : locale === 'ja'
          ? '観光分散効果とローカル指標は韓国観光データラボの公開データに基づくモデル推定であり、将来の実測成果ではありません。'
          : '관광 분산 효과 및 로컬 매장 지표는 한국관광 데이터랩 공공데이터 기반 모델 추정치입니다 (실측 미래 성과 아님).';
    const explanationWarning =
      trip.recommendationResult?.explanation?.mode === 'fallback'
        ? locale === 'ja'
          ? 'AIによる詳細な旅程説明の生成が完了しなかったため、ルールベースの説明を適用しました。'
          : 'AI 상세 일정 설명을 생성하지 못하여 규칙 기반 설명이 적용되었습니다.'
        : null;
    const providerWarnings = [
      ...(this.placeProvider.mode === 'mock'
        ? ['장소 정보는 명시적인 MOCK fixture입니다. 실제 장소 API 결과가 아닙니다.']
        : []),
      ...(this.crowdProvider.mode === 'mock'
        ? ['혼잡도 정보는 명시적인 MOCK fixture입니다. 실제 서울시 데이터가 아닙니다.']
        : []),
      ...(priceWarning ? [priceWarning] : []),
      tourismWarning,
      ...(explanationWarning ? [explanationWarning] : []),
    ];
    return {
      trip: toTripDto(trip, editToken),
      ...(isGeneration && editToken ? { editToken } : {}),
      providerModes: {
        place: trip.providerMode,
        kto: this.ktoProvider.mode,
        tourism: this.tripTourismMode(trip),
        crowd: trip.stops?.some((stop) => stop.crowdContext)
          ? this.crowdProvider.mode
          : 'unavailable',
        llm: trip.preference.parserMode,
        explanation: trip.recommendationResult?.explanation?.mode ?? 'mock',
        routing: this.routingProvider.mode,
        accessibility: trip.stops?.some((stop) => stop.accessibilityContext?.status === 'checked')
          ? 'live'
          : 'unavailable',
      },
      providerSources: {
        place: this.placeProvider.name,
        crowd: this.crowdProvider.name,
      },
      warnings: [...new Set([...warnings, ...providerWarnings])],
    };
  }

  private tripTourismMode(trip: Trip): 'live' | 'mock' | 'mixed' | 'unavailable' {
    const modes = new Set(
      (trip.stops ?? [])
        .map((stop) => stop.tourismEvidence?.dataMode)
        .filter(
          (mode): mode is 'live' | 'mock' | 'mixed' =>
            mode === 'live' || mode === 'mock' || mode === 'mixed',
        ),
    );
    if (modes.size === 0) return 'unavailable';
    if (modes.size > 1 || modes.has('mixed')) return 'mixed';
    return modes.has('live') ? 'live' : 'mock';
  }

  private availableTourismEvidence(
    evidence: CandidatePlace['tourism'],
  ): NonNullable<CandidatePlace['tourism']> | null {
    if (
      !evidence ||
      (evidence.concentration.concentration === null &&
        evidence.tourismFlow === null &&
        evidence.sources.length === 0)
    ) {
      return null;
    }
    return evidence;
  }

  async getStopAlternatives(tripId: string, stopId: string): Promise<StopAlternativesResponse> {
    const trip = await this.loadTrip(tripId);
    const stop = trip.stops.find((s) => s.id === stopId);
    if (!stop) {
      throw new NotFoundException({ code: 'STOP_NOT_FOUND', message: 'Stop not found in trip' });
    }

    const currentPlaceIds = new Set(trip.stops.map((s) => s.placeId));
    const targetPlace = stop.place;
    const targetDistrict = targetPlace.district || trip.preference?.area || '중구';
    const targetCategory = targetPlace.category;
    const allowedSources = allowedPlaceSourcesForTrip(
      trip.providerMode,
      this.placeProvider.name,
      this.ktoProvider.name,
      trip.stops.map((candidate) => candidate.place.source),
    );

    const queryBuilder = this.places.createQueryBuilder('p');
    if (currentPlaceIds.size > 0) {
      queryBuilder.where('p.id NOT IN (:...excludeIds)', {
        excludeIds: Array.from(currentPlaceIds),
      });
    }
    queryBuilder.andWhere('p.source IN (:...allowedSources)', { allowedSources });

    if (targetCategory) {
      queryBuilder.andWhere('(p.category = :cat OR p.district = :dist)', {
        cat: targetCategory,
        dist: targetDistrict,
      });
    } else {
      queryBuilder.andWhere('p.district = :dist', { dist: targetDistrict });
    }

    queryBuilder.andWhere(
      "NOT (p.name ILIKE '%DMZ%' OR p.name ILIKE '%판문점%' OR p.name ILIKE '%통일전망대%' OR p.name ILIKE '%제1땅굴%' OR p.name ILIKE '%제2땅굴%' OR p.name ILIKE '%제3땅굴%' OR p.name ILIKE '%제4땅굴%' OR p.name ILIKE '%도라산%' OR p.name ILIKE '%임진각%' OR p.name ILIKE '%탈북%' OR (p.name ILIKE '%북한%' AND p.name NOT ILIKE '%북한산%'))",
    );

    let candidates = await queryBuilder.take(20).getMany();

    if (candidates.length < 3 && currentPlaceIds.size > 0) {
      candidates = await this.places
        .createQueryBuilder('p')
        .where('p.id NOT IN (:...excludeIds)', {
          excludeIds: Array.from(currentPlaceIds),
        })
        .andWhere('p.source IN (:...allowedSources)', { allowedSources })
        .andWhere(
          "NOT (p.name ILIKE '%DMZ%' OR p.name ILIKE '%판문점%' OR p.name ILIKE '%통일전망대%' OR p.name ILIKE '%제1땅굴%' OR p.name ILIKE '%제2땅굴%' OR p.name ILIKE '%제3땅굴%' OR p.name ILIKE '%제4땅굴%' OR p.name ILIKE '%도라산%' OR p.name ILIKE '%임진각%' OR p.name ILIKE '%탈북%' OR (p.name ILIKE '%북한%' AND p.name NOT ILIKE '%북한산%'))",
        )
        .take(15)
        .getMany();
    }

    candidates = candidates.filter(
      (p) =>
        !isNorthKoreaRelated(p.name) &&
        !isNorthKoreaRelated(p.category) &&
        !isNorthKoreaRelated(p.rawCategory) &&
        !isNorthKoreaRelated(p.address) &&
        !isNorthKoreaRelated(p.roadAddress),
    );

    const results = candidates.map((p) => {
      const verifiedPrice = verifiedPlacePrice(p.estimatedCostKrw, p.priceEvidence);
      const estimatedCost = verifiedPrice?.estimatedCostKrw ?? null;
      const priceEvidence = verifiedPrice?.priceEvidence ?? null;

      let distanceMeters: number | undefined;
      if (p.location && targetPlace.location) {
        const lat1 = targetPlace.location.coordinates[1];
        const lon1 = targetPlace.location.coordinates[0];
        const lat2 = p.location.coordinates[1];
        const lon2 = p.location.coordinates[0];
        if (lat1 != null && lon1 != null && lat2 != null && lon2 != null) {
          const dLat = ((lat2 - lat1) * Math.PI) / 180;
          const dLon = ((lon2 - lon1) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
              Math.cos((lat2 * Math.PI) / 180) *
              Math.sin(dLon / 2) *
              Math.sin(dLon / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          distanceMeters = Math.round(6371000 * c);
        }
      }

      const rawOverview = (p.rawPayload?.overview ||
        p.rawPayload?.description ||
        p.rawPayload?.summary ||
        '') as string;
      const cleanOverview = rawOverview.replace(/<[^>]+>/g, '').trim();
      const walkMins = distanceMeters != null ? Math.max(1, Math.round(distanceMeters / 70)) : null;

      const description =
        cleanOverview ||
        `${p.name}은(는) ${targetPlace.name} 인근${walkMins ? `(도보 약 ${walkMins}분)` : ''}에 위치한 ${p.category || '인기'} 장소로, 이동 동선과 일정 흐름에 자연스럽게 어울리는 대안 후보입니다.`;

      return {
        placeId: p.id,
        name: p.name,
        category: p.category || p.rawCategory || '관광지',
        address: p.address || p.roadAddress || '서울시',
        roadAddress: p.roadAddress ?? null,
        latitude: p.location ? p.location.coordinates[1] : 37.5665,
        longitude: p.location ? p.location.coordinates[0] : 126.978,
        estimatedCost,
        priceEvidence,
        reason: `${targetPlace.name} 대신 방문하기 좋은 ${p.category || '명소'}`,
        description,
        distanceMeters,
      };
    });

    results.sort((a, b) => (a.distanceMeters ?? 99999) - (b.distanceMeters ?? 99999));

    return {
      targetStop: {
        id: stop.id,
        name: targetPlace.name,
        category: targetPlace.category || '장소',
      },
      alternatives: results.slice(0, 3),
    };
  }

  async searchHotels(query: string, area?: string): Promise<SearchHotelItem[]> {
    if (!query || query.trim().length === 0) return [];
    const trimmed = query.trim();

    let searchQuery = trimmed;
    if (/ロッテ|lotte/iu.test(trimmed)) searchQuery = '롯데호텔';
    else if (/新羅|シーラ|shilla/iu.test(trimmed)) searchQuery = '신라호텔';
    else if (/ナインツリー|nine\s*tree/iu.test(trimmed)) searchQuery = '나인트리 호텔';
    else if (/ウェスティン|조선|chosun/iu.test(trimmed)) searchQuery = '웨스틴 조선 서울';
    else if (/明洞|ミョンドン/iu.test(trimmed) && !trimmed.includes('호텔'))
      searchQuery = '명동 호텔';
    else if (/弘大|ホンデ/iu.test(trimmed) && !trimmed.includes('호텔')) searchQuery = '홍대 호텔';
    else if (/聖水|ソンス/iu.test(trimmed) && !trimmed.includes('호텔')) searchQuery = '성수 호텔';
    else if (
      !/호텔|숙소|hotel|스테이|게스트하우스|모텔|호스텔|리조트/i.test(trimmed) &&
      trimmed.length <= 4
    ) {
      searchQuery = `${trimmed} 호텔`;
    }

    const searchArea = area && area !== '서울' && !searchQuery.includes(area) ? area : '';
    const result = await this.placeProvider.search({
      query: searchQuery,
      area: searchArea,
      limit: 10,
    });

    return result.places
      .filter(
        (p) =>
          !isNorthKoreaRelated(p.name) &&
          !isNorthKoreaRelated(p.address) &&
          !isNorthKoreaRelated(p.roadAddress) &&
          !/주차장|편의점|카페|뷔페|세븐일레븐|CU|GS25/i.test(p.name),
      )
      .map((p) => ({
        name: p.name,
        roadAddress: p.roadAddress ?? null,
        address: p.address ?? null,
        category: p.rawCategory ?? 'hotel',
        latitude: p.latitude ?? null,
        longitude: p.longitude ?? null,
      }));
  }
}

function seoulTimeString(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value);
}

function seoulDateString(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}
