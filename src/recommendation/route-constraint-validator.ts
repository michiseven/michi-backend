import { Injectable } from '@nestjs/common';
import type {
  CandidatePlace,
  OpeningInterval,
  OptimizeRouteInput,
  RouteConstraintValidatorPort,
  RouteConstraintViolation,
  RouteStopPlan,
  RouteValidationResult,
} from './ports';

function dateAtTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+09:00`);
}

function applicableIntervals(place: CandidatePlace, travelDate: string): OpeningInterval[] | null {
  if (!place.openingHours || place.openingHours.length === 0) return null;
  const day = new Date(`${travelDate}T12:00:00+09:00`).getUTCDay();
  return place.openingHours.filter(
    (interval) => !interval.daysOfWeek || interval.daysOfWeek.includes(day),
  );
}

function isInsideKnownHours(
  place: CandidatePlace,
  travelDate: string,
  arrival: Date,
  leave: Date,
): boolean | null {
  const intervals = applicableIntervals(place, travelDate);
  if (intervals === null) return null;
  return intervals.some((interval) => {
    const opens = dateAtTime(travelDate, interval.opensAt);
    const closes = dateAtTime(travelDate, interval.closesAt);
    return closes > opens && arrival >= opens && leave <= closes;
  });
}

@Injectable()
export class RouteConstraintValidator implements RouteConstraintValidatorPort {
  validate(input: OptimizeRouteInput, route: RouteStopPlan[]): RouteValidationResult {
    const violations: RouteConstraintViolation[] = [];
    const warningValues: string[] = [];
    const start = dateAtTime(input.travelDate, input.startTime);
    const end = dateAtTime(input.travelDate, input.endTime);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      violations.push({
        code: 'INVALID_TRIP_WINDOW',
        message: 'Trip end time must be later than start time on the same Seoul date.',
      });
    }

    const candidateById = new Map(
      input.candidates.map((candidate) => [candidate.place.placeId, candidate]),
    );
    const seen = new Set<string>();
    let previousLeave: Date | null = null;
    let knownCost = 0;
    let unknownCost = false;
    let unknownHours = false;
    for (const [index, stop] of route.entries()) {
      if (stop.order !== index + 1) {
        violations.push({
          code: 'NON_CONTIGUOUS_ORDER',
          placeId: stop.placeId,
          message: 'Route orders must be one-based and contiguous.',
        });
      }
      if (seen.has(stop.placeId)) {
        violations.push({
          code: 'DUPLICATE_PLACE',
          placeId: stop.placeId,
          message: 'A place may appear only once in a route.',
        });
      }
      seen.add(stop.placeId);

      const arrival = new Date(stop.arrivalAt);
      const leave = new Date(stop.leaveAt);
      if (arrival < start || leave > end || leave <= arrival) {
        violations.push({
          code: 'OUTSIDE_TRIP_WINDOW',
          placeId: stop.placeId,
          message: 'The stop must fit inside the requested trip window.',
        });
      }
      if (previousLeave && arrival < previousLeave) {
        violations.push({
          code: 'OVERLAPPING_STOPS',
          placeId: stop.placeId,
          message: 'A stop cannot start before the previous stop leaves.',
        });
      }
      const actualStay = (leave.getTime() - arrival.getTime()) / 60_000;
      if (actualStay !== stop.estimatedStayMinutes) {
        violations.push({
          code: 'INVALID_STAY_DURATION',
          placeId: stop.placeId,
          message: 'The scheduled duration must match estimatedStayMinutes.',
        });
      }

      if (stop.estimatedCost === null) unknownCost = true;
      else knownCost += stop.estimatedCost;
      const candidate = candidateById.get(stop.placeId);
      if (candidate) {
        const insideHours = isInsideKnownHours(candidate.place, input.travelDate, arrival, leave);
        if (insideHours === null) unknownHours = true;
        else if (!insideHours) {
          violations.push({
            code: 'OUTSIDE_KNOWN_OPENING_HOURS',
            placeId: stop.placeId,
            message: 'The stop falls outside provider-backed opening hours.',
          });
        }
      }
      previousLeave = leave;
    }

    if (input.budget !== null && knownCost > input.budget) {
      violations.push({
        code: 'BUDGET_EXCEEDED',
        message: 'The sum of known stop costs exceeds the requested budget.',
      });
    }
    if (unknownCost) {
      warningValues.push('가격이 확인되지 않은 장소가 있어 전체 예산 충족 여부는 부분 검증입니다.');
    }
    if (unknownHours) {
      warningValues.push(
        '영업시간이 확인되지 않은 장소는 영업 여부를 추측하지 않고 일정에 포함했습니다.',
      );
    }
    return {
      valid: violations.length === 0,
      violations,
      warnings: [...new Set(warningValues)],
    };
  }
}

export { isInsideKnownHours };
