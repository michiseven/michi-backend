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

/** Preference-policy markers are not place themes and must not become hard evidence promises. */
export function isPublicationPolicyOnlyToken(value: string): boolean {
  const compact = normalized(value);
  return (
    /^local(?:[_ -]?specialty)?$/iu.test(compact) ||
    /^(?:실내|indoor|屋内|우천|비|rain|雨)$/iu.test(compact) ||
    /(?:유모차|아기차|stroller|baby carriage|ベビーカー|휠체어|wheelchair|車椅子|계단.*(?:피|없|제외)|stairs?(?: avoid| free)?|階段.*(?:避|なし))/iu.test(
      compact,
    )
  );
}

/**
 * Preferences often describe constraints (quiet, children, short walking), not
 * a place the itinerary must contain.  Promote only the phrases that actually
 * name a visitable activity, and map them to the same canonical roles used by
 * search and ranking.  This prevents a valid cafe route from being rejected
 * because no stop literally contains the word "quiet".
 */
export function publicationThemeFromPreference(value: string): string | null {
  const compact = normalized(value);
  if (/산책|散歩|stroll/u.test(compact)) return 'stroll';
  if (/사진|photo|撮影/u.test(compact)) return 'photography';
  if (/벚꽃|桜|피크닉|picnic/u.test(compact)) return 'park';
  if (/쇼핑|shopping|買い物|雑貨/u.test(compact)) return 'shopping';
  if (/한옥|韓屋|hanok/u.test(compact)) return '한옥';
  if (/전통|伝統|역사|歴史/u.test(compact)) return '전통';
  if (/야경|夜景|night[_ -]?view/u.test(compact)) return 'night_view';
  if (/라이브|live|음악|音楽/u.test(compact)) return 'live';
  if (/카페|cafe|カフェ/u.test(compact)) return 'cafe';
  return null;
}

function isRequiredTheme(theme: string): boolean {
  return !isGenericWalkActivity(theme) && !isPublicationPolicyOnlyToken(theme);
}

export function themeMatchesStop(
  theme: string,
  stop: CompletionEligibilityInput['stops'][number],
): boolean {
  const requested = normalized(theme);
  if (/산책|散歩|stroll/u.test(requested)) {
    // Parks and walking trails are direct evidence. A verified heritage/tourist
    // walking destination such as a hanok village also supports a stroll;
    // an arbitrary street name or a transit leg still does not.
    if (
      typeof stop.category === 'string' &&
      (STROLL_ACCEPTED_PLACE_CATEGORIES as readonly string[]).includes(stop.category)
    ) {
      return true;
    }
    const heritageWalkEvidence = normalized(`${stop.name ?? ''} ${stop.rawCategory ?? ''}`);
    return (
      (stop.category === 'attraction' || stop.category === 'culture') &&
      // A named scenic viewpoint (for example Bukchon Eight Views) is a
      // public, visitable walking destination. It is distinct from an
      // arbitrary street whose name merely contains "walk".
      /한옥마을|韓屋村|heritage|역사문화|전통마을|관광명소|tourist|(?:북촌)?(?:8경|팔경|八景)|전망(?:명소|대)?|viewpoint/.test(
        heritageWalkEvidence,
      )
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
    [/라이브|live|음악|音楽/u, /라이브|live|음악|音楽|공연|公演|재즈|jazz|클럽|club/u],
    // Photographing while walking is fulfilled by a verified scenic public
    // place too; it does not require a business literally named "photo spot".
    [/사진|写真|photo|撮影/u, /사진|写真|photo|촬영|撮影|뷰|view|전망/u],
    [/야경|夜景|night[_ -]?view/u, /야경|夜景|전망|view|night/u],
    [/쇼핑|shopping|買い物|雑貨/u, /쇼핑|shopping|편집|소품|雑貨|shop/u],
    [/바|bar|バー|pub/u, /바|bar|バー|pub|술집|주점|酒場|칵테일|cocktail|와인|wine/u],
  ];
  if (
    /사진|写真|photo|撮影/u.test(requested) &&
    ['park', 'stroll', 'culture', 'attraction'].includes(stop.category ?? '')
  ) {
    return true;
  }
  // A named Han River/riverside park is a verifiable public viewpoint for an
  // evening skyline route. Do not treat an arbitrary daytime park as night-view
  // evidence.
  if (
    /야경|夜景|night[_ -]?view/u.test(requested) &&
    stop.category === 'park' &&
    /한강|漢江|강변|riverside|waterfront/.test(evidence)
  ) {
    return true;
  }
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
  for (const theme of input.requestedThemes.filter(isRequiredTheme)) {
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
      .filter(isRequiredTheme)
      .some((theme) => !input.stops.some((stop) => themeMatchesStop(theme, stop)))
  ) {
    return { eligible: false, code: 'THEME_EVIDENCE_MISSING' };
  }
  return { eligible: true };
}
