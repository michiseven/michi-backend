import { STROLL_ACCEPTED_PLACE_CATEGORIES } from '../preferences/preference.types';

export interface CompletionEligibilityInput {
  startTime: string;
  endTime: string;
  requestedMeal: boolean;
  requestedThemes: string[];
  stops: Array<{
    stopType: string;
    estimatedStayMinutes: number;
    name?: string | null;
    category?: string | null;
    rawCategory?: string | null;
    inboundRoute?: { durationMinutes?: number; evidence?: string | null } | null;
  }>;
}

export interface PublicationValidation {
  publicationStatus: 'ready' | 'blocked';
  requiredActivities: { status: 'pass' | 'fail'; missing: string[] };
  area: { status: 'pass' | 'fail'; outsidePlaceIds: string[] };
  time: { status: 'pass' | 'fail'; violations: string[] };
  failureCodes: PublicationFailureCode[];
}

export type PublicationFailureCode =
  | 'INSUFFICIENT_VERIFIED_COVERAGE'
  | 'MEAL_EVIDENCE_MISSING'
  | 'THEME_EVIDENCE_MISSING'
  | 'AREA_CONSTRAINTS_VIOLATED'
  | 'ROUTE_CONSTRAINTS_VIOLATED';

export interface PublicationValidationInput extends CompletionEligibilityInput {
  area: { valid: boolean; outsidePlaceIds?: string[] };
  time: { valid: boolean; violations?: string[] };
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

/** Walking as a transport preference is not a place-category promise. A
 * requested stroll, however, is a required activity and must have a place. */
function isGenericWalkActivity(theme: string): boolean {
  return /^(?:도보|걷기|walk(?:ing)?|徒歩)$/iu.test(normalized(theme));
}

function themeMatchesStop(
  theme: string,
  stop: CompletionEligibilityInput['stops'][number],
): boolean {
  const requested = normalized(theme);
  if (/산책|散歩|stroll/u.test(requested)) {
    // The stroll role is fulfilled only by a normalized park/stroll candidate;
    // a transit leg or an arbitrary street name is not enough evidence.
    return (
      typeof stop.category === 'string' &&
      (STROLL_ACCEPTED_PLACE_CATEGORIES as readonly string[]).includes(stop.category)
    );
  }
  const evidence = normalized(
    `${stop.name ?? ''} ${stop.category ?? ''} ${stop.rawCategory ?? ''}`,
  );
  if (requested.length < 2) return true;
  if (evidence.includes(requested)) return true;
  const aliases: Array<[RegExp, RegExp]> = [
    [/한옥|韓屋|hanok/u, /한옥|韓屋|hanok/u],
    [/전통|伝統|역사|歴史/u, /전통|伝統|역사|歴史|궁|宮|博物|문화|文化/u],
    [/문화|文化|미술|アート|art/u, /문화|文化|미술|美術|박물|博物|gallery|art/u],
    // An explicit park must be evidenced as a park; a street/walk is not a substitute.
    [/공원|公園/u, /공원|公園/u],
    [/라이브|live|음악|音楽/u, /라이브|live|음악|音楽|공연|公演/u],
  ];
  return aliases.some(
    ([requestedPattern, evidencePattern]) =>
      requestedPattern.test(requested) && evidencePattern.test(evidence),
  );
}

function missingRequiredActivities(input: CompletionEligibilityInput): string[] {
  const missing: string[] = [];
  if (input.requestedMeal && !input.stops.some((stop) => stop.stopType === 'meal')) {
    missing.push('meal');
  }
  for (const theme of input.requestedThemes.filter((value) => !isGenericWalkActivity(value))) {
    if (!input.stops.some((stop) => themeMatchesStop(theme, stop))) missing.push(theme);
  }
  return missing;
}

/**
 * Publication-level contract. A route can be technically optimizable while
 * still lacking a required role or a verifiable area boundary; callers must
 * keep the result blocked until every hard check passes.
 */
export function completedItineraryPublicationValidation(
  input: PublicationValidationInput,
): PublicationValidation {
  const eligibility = completedItineraryEligibility(input);
  const missing = missingRequiredActivities(input);
  const coverageFailure = eligibility.eligible
    ? null
    : eligibility.code === 'INSUFFICIENT_VERIFIED_COVERAGE'
      ? eligibility.code
      : null;
  const activityFailure: PublicationFailureCode | null =
    missing.length > 0
      ? missing.includes('meal')
        ? 'MEAL_EVIDENCE_MISSING'
        : 'THEME_EVIDENCE_MISSING'
      : null;
  const failureCodes: PublicationFailureCode[] = [
    ...(coverageFailure ? [coverageFailure] : []),
    ...(activityFailure ? [activityFailure] : []),
    ...(!input.area.valid ? (['AREA_CONSTRAINTS_VIOLATED'] as const) : []),
    ...(!input.time.valid ? (['ROUTE_CONSTRAINTS_VIOLATED'] as const) : []),
  ];
  return {
    publicationStatus: failureCodes.length === 0 ? 'ready' : 'blocked',
    requiredActivities: { status: missing.length === 0 ? 'pass' : 'fail', missing },
    area: {
      status: input.area.valid ? 'pass' : 'fail',
      outsidePlaceIds: input.area.outsidePlaceIds ?? [],
    },
    time: {
      status: input.time.valid ? 'pass' : 'fail',
      violations: input.time.violations ?? [],
    },
    failureCodes,
  };
}

export function completedItineraryEligibility(input: CompletionEligibilityInput):
  | { eligible: true }
  | {
      eligible: false;
      code: 'INSUFFICIENT_VERIFIED_COVERAGE' | 'MEAL_EVIDENCE_MISSING' | 'THEME_EVIDENCE_MISSING';
    } {
  const [startHour = 0, startMinute = 0] = input.startTime.split(':').map(Number);
  const [endHour = 0, endMinute = 0] = input.endTime.split(':').map(Number);
  const windowMinutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (windowMinutes >= 240 && windowMinutes <= 360) {
    const covered = input.stops.reduce((total, stop) => {
      const route = stop.inboundRoute;
      const verifiedTravelMinutes =
        route && (route.evidence === 'measured' || route.evidence === 'mixed')
          ? (route.durationMinutes ?? 0)
          : 0;
      return total + stop.estimatedStayMinutes + verifiedTravelMinutes;
    }, 0);
    if (covered < windowMinutes * 0.6) {
      return { eligible: false, code: 'INSUFFICIENT_VERIFIED_COVERAGE' };
    }
  }
  if (input.requestedMeal && !input.stops.some((stop) => stop.stopType === 'meal')) {
    return { eligible: false, code: 'MEAL_EVIDENCE_MISSING' };
  }
  if (
    input.requestedThemes
      .filter((theme) => !isGenericWalkActivity(theme))
      .some((theme) => !input.stops.some((stop) => themeMatchesStop(theme, stop)))
  ) {
    return { eligible: false, code: 'THEME_EVIDENCE_MISSING' };
  }
  return { eligible: true };
}
