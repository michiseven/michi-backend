import { Inject, Injectable, Optional } from '@nestjs/common';
import { DistanceBasedRoutingProvider } from '../routing/distance-based-routing.provider';
import { ROUTING_PROVIDER, type RoutingProvider } from '../routing/routing-provider';
import type { RouteLegEstimate } from '../routing/routing-provider';
import type { TripStopType } from '../database/entities/trip-stop.entity';
import { coordinatesOf } from './geo';
import type {
  OpeningInterval,
  OptimizeRouteInput,
  RankedCandidate,
  RouteOptimizer,
  RouteStopPlan,
} from './ports';
import { RouteConstraintValidator } from './route-constraint-validator';
import { extractBrandKey } from './brand-extractor';

const LUNCH_START = '11:30';
const LUNCH_END = '14:00';
const DINNER_START = '17:30';
const DINNER_END = '20:00';

function dateAtTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+09:00`);
}

function travelMinutes(
  routing: RoutingProvider,
  input: OptimizeRouteInput,
  a: RankedCandidate | undefined,
  b: RankedCandidate,
): number {
  if (!a) return 0;
  return legEstimate(routing, input, a, b).durationMinutes;
}

function proximityScore(
  routing: RoutingProvider,
  input: OptimizeRouteInput,
  a: RankedCandidate | undefined,
  b: RankedCandidate,
): number {
  if (!a) return 0.5;
  const distance = legEstimate(routing, input, a, b).distanceKm;
  return distance === null ? 0 : 1 / (1 + distance);
}

function legEstimate(
  routing: RoutingProvider,
  input: OptimizeRouteInput,
  a: RankedCandidate,
  b: RankedCandidate,
): RouteLegEstimate {
  return (
    input.legEstimates?.[`${a.place.placeId}->${b.place.placeId}`] ??
    routing.planningEstimate(a.place.location, b.place.location)
  );
}

function applicableIntervals(
  candidate: RankedCandidate,
  travelDate: string,
): OpeningInterval[] | null {
  const hours = candidate.place.openingHours;
  if (!hours || hours.length === 0) return null;
  const day = new Date(`${travelDate}T12:00:00+09:00`).getUTCDay();
  return hours.filter((interval) => !interval.daysOfWeek || interval.daysOfWeek.includes(day));
}

function alignWithKnownHours(
  input: OptimizeRouteInput,
  candidate: RankedCandidate,
  earliestArrival: Date,
): Date | null {
  const intervals = applicableIntervals(candidate, input.travelDate);
  if (intervals === null) return earliestArrival;
  const sorted = [...intervals].sort((a, b) => a.opensAt.localeCompare(b.opensAt));
  for (const interval of sorted) {
    const opens = dateAtTime(input.travelDate, interval.opensAt);
    const closes = dateAtTime(input.travelDate, interval.closesAt);
    if (closes <= opens) continue;
    const arrival = earliestArrival < opens ? opens : earliestArrival;
    const leave = new Date(arrival.getTime() + candidate.estimatedStayMinutes * 60_000);
    if (leave <= closes) return arrival;
  }
  return null;
}

function alignWithMealWindow(
  input: OptimizeRouteInput,
  candidate: RankedCandidate,
  arrival: Date,
): Date {
  if (candidate.place.category !== 'restaurant') return arrival;

  if (input.mealWindows && input.mealWindows.length > 0) {
    for (const window of input.mealWindows) {
      const windowTarget = dateAtTime(input.travelDate, window.targetTime);
      const windowEnd = new Date(windowTarget.getTime() + 60 * 60_000);
      if (arrival <= windowEnd) {
        return arrival < windowTarget ? windowTarget : arrival;
      }
    }
  }

  const rawCategory = candidate.place.rawCategory ?? '';
  const dinnerOnly = /고기|육류|갈비|焼肉|meat/i.test(rawCategory);
  const lunchStart = dateAtTime(input.travelDate, LUNCH_START);
  const lunchEnd = dateAtTime(input.travelDate, LUNCH_END);
  const dinnerStart = dateAtTime(input.travelDate, DINNER_START);
  const dinnerEnd = dateAtTime(input.travelDate, DINNER_END);
  const tripEnd = dateAtTime(input.travelDate, input.endTime);
  if (!dinnerOnly && arrival <= lunchEnd && tripEnd >= lunchStart) {
    return arrival < lunchStart ? lunchStart : arrival;
  }
  if (tripEnd >= dinnerStart && arrival <= dinnerEnd) {
    return arrival < dinnerStart ? dinnerStart : arrival;
  }
  return arrival;
}

function mealTimingScore(
  input: OptimizeRouteInput,
  candidate: RankedCandidate,
  arrival: Date,
): number {
  if (candidate.place.category !== 'restaurant') return 1;

  if (input.mealWindows && input.mealWindows.length > 0) {
    for (const window of input.mealWindows) {
      const windowTarget = dateAtTime(input.travelDate, window.targetTime);
      const windowStart = new Date(windowTarget.getTime() - 45 * 60_000);
      const windowEnd = new Date(windowTarget.getTime() + 60 * 60_000);
      if (arrival >= windowStart && arrival <= windowEnd) return 1;
    }
  }

  const rawCategory = candidate.place.rawCategory ?? '';
  const dinnerOnly = /고기|육류|갈비|焼肉|meat/i.test(rawCategory);
  const lunchStart = dateAtTime(input.travelDate, LUNCH_START);
  const lunchEnd = dateAtTime(input.travelDate, LUNCH_END);
  const dinnerStart = dateAtTime(input.travelDate, DINNER_START);
  const dinnerEnd = dateAtTime(input.travelDate, DINNER_END);
  if (!dinnerOnly && arrival >= lunchStart && arrival <= lunchEnd) return 1;
  return arrival >= dinnerStart && arrival <= dinnerEnd ? 1 : 0;
}

interface ScheduledCandidate {
  candidate: RankedCandidate;
  arrival: Date;
  leave: Date;
  utility: number;
}

function determineStopType(candidate: RankedCandidate): TripStopType {
  if (
    /공항|airport|incheon|gimpo/i.test(candidate.place.name) ||
    candidate.place.rawCategory === 'airport' ||
    candidate.place.category === 'airport'
  ) {
    return 'airport';
  }
  if (candidate.place.fixedAppointment) {
    return 'fixed_appointment';
  }
  if (
    candidate.place.anchorRole === 'start' ||
    candidate.place.anchorRole === 'destination' ||
    candidate.place.rawCategory === 'basecamp' ||
    candidate.place.category === 'hotel' ||
    /호텔|숙소|게스트하우스|에어비앤비|Hotel/i.test(candidate.place.name)
  ) {
    return 'basecamp';
  }
  if (candidate.place.category === 'restaurant') {
    return 'meal';
  }
  if (candidate.isAnchor || candidate.place.isAnchor) {
    return 'must_visit';
  }
  return 'general';
}

function scheduleCandidate(
  routing: RoutingProvider,
  input: OptimizeRouteInput,
  candidate: RankedCandidate,
  cursor: Date,
  previous: RankedCandidate | undefined,
  usedCategories: ReadonlySet<string>,
): ScheduledCandidate | null {
  if (previous) {
    const leg = legEstimate(routing, input, previous, candidate);
    if (input.maxWalkDistanceKm !== null && input.maxWalkDistanceKm !== undefined) {
      if (leg.distanceKm !== null && leg.distanceKm > input.maxWalkDistanceKm) {
        return null;
      }
    }
    if (input.maxWalkMinutes !== null && input.maxWalkMinutes !== undefined) {
      if (leg.durationMinutes > input.maxWalkMinutes) {
        return null;
      }
    }
  }

  // Fixed appointment with exact target time
  if (candidate.place.fixedAppointment && candidate.place.targetTime) {
    const targetArrival = dateAtTime(input.travelDate, candidate.place.targetTime);
    const minTravelArrival = new Date(
      cursor.getTime() + travelMinutes(routing, input, previous, candidate) * 60_000,
    );
    if (minTravelArrival > targetArrival) {
      return null;
    }
    const arrival = targetArrival;
    const leave = new Date(arrival.getTime() + candidate.estimatedStayMinutes * 60_000);
    if (leave > dateAtTime(input.travelDate, input.endTime)) return null;

    const utility = 100.0;
    return { candidate, arrival, leave, utility };
  }

  const travelArrival = new Date(
    cursor.getTime() + travelMinutes(routing, input, previous, candidate) * 60_000,
  );
  const mealArrival = alignWithMealWindow(input, candidate, travelArrival);
  const arrival = alignWithKnownHours(input, candidate, mealArrival);
  if (!arrival) return null;
  const leave = new Date(arrival.getTime() + candidate.estimatedStayMinutes * 60_000);
  if (leave > dateAtTime(input.travelDate, input.endTime)) return null;

  const prevCat = previous?.place.category;
  const currCat = candidate.place.category;
  const isConsecutiveCafe = prevCat === 'cafe' && currCat === 'cafe';
  const isConsecutiveRestaurant = prevCat === 'restaurant' && currCat === 'restaurant';
  const isConsecutiveSameCategory = Boolean(prevCat && currCat && prevCat === currCat);

  // Consecutive category penalty: strongly avoid back-to-back cafes or restaurants
  let consecutivePenalty = 0;
  if (isConsecutiveCafe || isConsecutiveRestaurant) {
    consecutivePenalty = 2.0;
  } else if (isConsecutiveSameCategory) {
    consecutivePenalty = 0.4;
  }

  const diversity = isConsecutiveSameCategory
    ? 0.0
    : currCat && !usedCategories.has(currCat)
      ? 1.0
      : 0.3;
  const mealTiming = mealTimingScore(input, candidate, travelArrival);

  const hasWalkingConstraint =
    (input.maxWalkMinutes !== null && input.maxWalkMinutes !== undefined) ||
    (input.maxWalkDistanceKm !== null && input.maxWalkDistanceKm !== undefined);
  const proximityWeight = hasWalkingConstraint ? 0.45 : 0.3;
  const totalScoreWeight = hasWalkingConstraint ? 0.35 : 0.45;

  const utility =
    candidate.scoreBreakdown.total * totalScoreWeight +
    proximityScore(routing, input, previous, candidate) * proximityWeight +
    diversity * 0.2 +
    mealTiming * 0.08 -
    consecutivePenalty;
  return { candidate, arrival, leave, utility };
}

function toPlan(scheduled: ScheduledCandidate, order: number): RouteStopPlan {
  const candidate = scheduled.candidate;
  const stopType = determineStopType(candidate);
  return {
    placeId: candidate.place.placeId,
    order,
    arrivalAt: scheduled.arrival.toISOString(),
    leaveAt: scheduled.leave.toISOString(),
    estimatedStayMinutes: candidate.estimatedStayMinutes,
    estimatedCost: candidate.estimatedCost,
    priceEvidence: candidate.priceEvidence ?? candidate.place.priceEvidence ?? null,
    reason: candidate.reason,
    scoreBreakdown: candidate.scoreBreakdown,
    stopType,
  };
}

@Injectable()
export class HeuristicRouteOptimizer implements RouteOptimizer {
  private readonly validator = new RouteConstraintValidator();
  private readonly routing: RoutingProvider;

  constructor(
    @Optional()
    @Inject(ROUTING_PROVIDER)
    routing?: RoutingProvider,
  ) {
    this.routing = routing ?? new DistanceBasedRoutingProvider();
  }

  optimize(input: OptimizeRouteInput): RouteStopPlan[] {
    const routeable = input.candidates.filter(
      (candidate, index, all) =>
        coordinatesOf(candidate.place.location) !== null &&
        all.findIndex((item) => item.place.placeId === candidate.place.placeId) === index,
    );
    const route = input.preserveOrder
      ? this.scheduleInGivenOrder(input, routeable)
      : this.scheduleGreedy(input, routeable);
    if (input.preserveOrder && route.length !== routeable.length) return [];
    if (
      input.mealWindows &&
      route.filter((stop) => stop.stopType === 'meal').length < input.mealWindows.length
    ) {
      return [];
    }
    return this.validator.validate(input, route).valid ? route : [];
  }

  private scheduleInGivenOrder(
    input: OptimizeRouteInput,
    candidates: RankedCandidate[],
  ): RouteStopPlan[] {
    const route: RouteStopPlan[] = [];
    const usedCategories = new Set<string>();
    let cursor = dateAtTime(input.travelDate, input.startTime);
    let previous: RankedCandidate | undefined;
    let knownCost = 0;
    for (const candidate of candidates) {
      const cost = candidate.estimatedCost;
      if (input.budget !== null && cost !== null && knownCost + cost > input.budget) return [];
      const scheduled = scheduleCandidate(
        this.routing,
        input,
        candidate,
        cursor,
        previous,
        usedCategories,
      );
      if (!scheduled) return [];
      route.push(toPlan(scheduled, route.length + 1));
      knownCost += cost ?? 0;
      cursor = scheduled.leave;
      previous = candidate;
      if (candidate.place.category) usedCategories.add(candidate.place.category);
    }
    return route;
  }

  private scheduleGreedy(
    input: OptimizeRouteInput,
    candidates: RankedCandidate[],
  ): RouteStopPlan[] {
    const anchorCandidate = input.anchorPlaceId
      ? candidates.find((c) => c.place.placeId === input.anchorPlaceId)
      : undefined;

    const isDestinationAnchor =
      anchorCandidate && (!input.anchorRole || input.anchorRole === 'destination');

    const remaining = isDestinationAnchor
      ? candidates.filter((c) => c.place.placeId !== anchorCandidate.place.placeId)
      : [...candidates];

    const route: RouteStopPlan[] = [];
    const usedCategories = new Set<string>();
    const usedBrands = new Set<string>();
    let cursor = dateAtTime(input.travelDate, input.startTime);
    let previous: RankedCandidate | undefined;
    let knownCost = 0;
    let scheduledRestaurantCount = 0;

    const anchorTargetDate =
      isDestinationAnchor && input.anchorTargetTime
        ? dateAtTime(input.travelDate, input.anchorTargetTime)
        : isDestinationAnchor
          ? dateAtTime(input.travelDate, input.endTime)
          : null;

    while (remaining.length > 0) {
      const feasible = remaining
        .filter((candidate) => {
          // Prevent multiple stops of the exact same brand in a single route
          const brand = extractBrandKey(candidate.place);
          if (
            brand &&
            usedBrands.has(brand) &&
            !candidate.place.fixedAppointment &&
            !candidate.isAnchor &&
            candidate.place.placeId !== input.anchorPlaceId
          ) {
            return false;
          }
          if (
            candidate.place.category === 'restaurant' &&
            input.mealWindows &&
            input.mealWindows.length > 0 &&
            scheduledRestaurantCount >= input.mealWindows.length
          ) {
            return false;
          }
          const cost = candidate.estimatedCost;
          return !(input.budget !== null && cost !== null && knownCost + cost > input.budget);
        })
        .map((candidate) =>
          scheduleCandidate(this.routing, input, candidate, cursor, previous, usedCategories),
        )
        .filter((candidate): candidate is ScheduledCandidate => {
          if (!candidate) return false;
          if (isDestinationAnchor && anchorTargetDate) {
            const travelToAnchorMin = travelMinutes(
              this.routing,
              input,
              candidate.candidate,
              anchorCandidate,
            );
            const earliestAnchorArrival = new Date(
              candidate.leave.getTime() + travelToAnchorMin * 60_000,
            );
            if (earliestAnchorArrival > anchorTargetDate) {
              return false;
            }
          }
          return true;
        })
        .sort(
          (a, b) =>
            b.utility - a.utility ||
            b.candidate.scoreBreakdown.total - a.candidate.scoreBreakdown.total ||
            a.candidate.place.sourcePlaceId.localeCompare(b.candidate.place.sourcePlaceId),
        );
      const next = feasible[0];
      if (!next) break;
      route.push(toPlan(next, route.length + 1));
      remaining.splice(remaining.indexOf(next.candidate), 1);
      knownCost += next.candidate.estimatedCost ?? 0;
      cursor = next.leave;
      previous = next.candidate;
      if (next.candidate.place.category === 'restaurant') scheduledRestaurantCount += 1;
      if (next.candidate.place.category) usedCategories.add(next.candidate.place.category);
      const scheduledBrand = extractBrandKey(next.candidate.place);
      if (scheduledBrand) usedBrands.add(scheduledBrand);
    }

    if (isDestinationAnchor && anchorCandidate) {
      const travelToAnchorMin = travelMinutes(this.routing, input, previous, anchorCandidate);
      const naturalArrival = new Date(cursor.getTime() + travelToAnchorMin * 60_000);
      const arrival =
        anchorTargetDate && anchorTargetDate >= naturalArrival ? anchorTargetDate : naturalArrival;
      const stayMin = anchorCandidate.estimatedStayMinutes;
      const leave = new Date(arrival.getTime() + stayMin * 60_000);

      const scheduledAnchor: ScheduledCandidate = {
        candidate: anchorCandidate,
        arrival,
        leave,
        utility: 1.0,
      };
      route.push(toPlan(scheduledAnchor, route.length + 1));
    }

    return route;
  }
}
