import type { CrowdObservation } from '../providers/crowd/crowd-provider';
import type { NormalizedPlace } from '../providers/place/place-normalizer';
import type { TripStopType } from '../database/entities/trip-stop.entity';
import type {
  FixedAppointmentPreference,
  MealWindowPreference,
  ParsedTripPreference,
} from '../preferences/preference.types';
import type { TourismPlaceFeatureEvidence } from '../tourism-feature/tourism-feature.types';
import type { RouteLegEstimate } from '../routing/routing-provider';

export const CANDIDATE_RANKER = Symbol('CANDIDATE_RANKER');
export const ROUTE_OPTIMIZER = Symbol('ROUTE_OPTIMIZER');
export const ROUTE_CONSTRAINT_VALIDATOR = Symbol('ROUTE_CONSTRAINT_VALIDATOR');

export interface ScoreWeights {
  preference: number;
  crowd: number;
  distance: number;
  time: number;
  budget: number;
  diversity: number;
  area: number;
}

export interface TourismScoreWeights extends ScoreWeights {
  tourismDispersion?: number;
  localImpact?: number;
}

export interface ScoreBreakdown {
  total: number;
  preference: number;
  crowd: number;
  distance: number;
  time: number;
  budget: number;
  diversity: number;
  area: number;
  tourismDispersion?: number | null;
  localImpact?: number | null;
}

export interface CandidatePlace extends NormalizedPlace {
  placeId: string;
  /** Provider/config-backed estimate only; absent values stay unknown. */
  estimatedCostKrw?: number | null;
  /** Price calculation evidence & menu list */
  priceEvidence?: import('../database/entities/entity-types').PriceEvidence | null;
  /** Product heuristic override, not a claimed provider fact. */
  estimatedStayMinutes?: number;
  /** Provider-backed local opening intervals; absent values stay unknown. */
  openingHours?: OpeningInterval[] | null;
  /** Imported tourism evidence with full source lineage; absent means unavailable, not zero. */
  tourism?: TourismPlaceFeatureEvidence;
  /** Fixed anchor venue (e.g. concert hall, meeting point). */
  isAnchor?: boolean;
  anchorRole?: 'start' | 'intermediate' | 'destination' | null;
  fixedAppointment?: boolean;
  targetTime?: string | null;
}

export interface OpeningInterval {
  /** JavaScript day numbers: Sunday 0 through Saturday 6. Omit for every day. */
  daysOfWeek?: number[];
  opensAt: string;
  closesAt: string;
}

export interface RankedCandidate {
  place: CandidatePlace;
  estimatedCost: number | null;
  priceEvidence?: import('../database/entities/entity-types').PriceEvidence | null;
  estimatedStayMinutes: number;
  reason: string;
  scoreBreakdown: ScoreBreakdown;
  isAnchor?: boolean;
}

export interface RankCandidatesInput {
  preference: ParsedTripPreference;
  places: CandidatePlace[];
  crowd: CrowdObservation | null;
  locale?: 'ja' | 'ko';
}

export interface RankCandidatesResult {
  algorithmVersion: string;
  weights: TourismScoreWeights;
  candidates: RankedCandidate[];
  warnings: string[];
}

export interface CandidateRanker {
  rank(input: RankCandidatesInput): RankCandidatesResult;
}

export interface OptimizeRouteInput {
  travelDate: string;
  startTime: string;
  endTime: string;
  budget: number | null;
  candidates: RankedCandidate[];
  /** Editing/recalculation path: keep the user's candidate order. */
  preserveOrder?: boolean;
  maxWalkMinutes?: number | null;
  maxWalkDistanceKm?: number | null;
  anchorPlaceId?: string | null;
  anchorTargetTime?: string | null;
  anchorRole?: 'start' | 'intermediate' | 'destination' | null;
  mealWindows?: MealWindowPreference[];
  fixedAppointments?: FixedAppointmentPreference[];
  /** Consecutive provider-measured legs keyed as `originPlaceId->destinationPlaceId`. */
  legEstimates?: Readonly<Record<string, RouteLegEstimate>>;
}

export interface RouteStopPlan {
  placeId: string;
  order: number;
  arrivalAt: string;
  leaveAt: string;
  estimatedStayMinutes: number;
  estimatedCost: number | null;
  priceEvidence?: import('../database/entities/entity-types').PriceEvidence | null;
  reason: string;
  scoreBreakdown: ScoreBreakdown;
  stopType?: TripStopType;
  rainFallbackPlaceId?: string | null;
}

export interface RouteOptimizer {
  optimize(input: OptimizeRouteInput): RouteStopPlan[];
}

export interface RouteConstraintViolation {
  code:
    | 'INVALID_TRIP_WINDOW'
    | 'NON_CONTIGUOUS_ORDER'
    | 'DUPLICATE_PLACE'
    | 'OUTSIDE_TRIP_WINDOW'
    | 'OVERLAPPING_STOPS'
    | 'INVALID_STAY_DURATION'
    | 'BUDGET_EXCEEDED'
    | 'OUTSIDE_KNOWN_OPENING_HOURS';
  placeId?: string;
  message: string;
}

export interface RouteValidationResult {
  valid: boolean;
  violations: RouteConstraintViolation[];
  warnings: string[];
}

export interface RouteConstraintValidatorPort {
  validate(input: OptimizeRouteInput, route: RouteStopPlan[]): RouteValidationResult;
}
