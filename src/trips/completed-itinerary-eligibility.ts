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

function normalized(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

function themeMatchesStop(
  theme: string,
  stop: CompletionEligibilityInput['stops'][number],
): boolean {
  const requested = normalized(theme);
  const evidence = normalized(
    `${stop.name ?? ''} ${stop.category ?? ''} ${stop.rawCategory ?? ''}`,
  );
  if (requested.length < 2) return true;
  if (evidence.includes(requested)) return true;
  const aliases: Array<[RegExp, RegExp]> = [
    [/한옥|韓屋|hanok/u, /한옥|韓屋|hanok/u],
    [/전통|伝統|역사|歴史/u, /전통|伝統|역사|歴史|궁|宮|博物|문화|文化/u],
    [/문화|文化|미술|アート|art/u, /문화|文化|미술|美術|박물|博物|gallery|art/u],
    [/산책|散歩|공원|公園/u, /산책|散歩|공원|公園|거리|街|歩道/u],
    [/라이브|live|음악|音楽/u, /라이브|live|음악|音楽|공연|公演/u],
  ];
  return aliases.some(
    ([requestedPattern, evidencePattern]) =>
      requestedPattern.test(requested) && evidencePattern.test(evidence),
  );
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
    input.requestedThemes.some(
      (theme) => !input.stops.some((stop) => themeMatchesStop(theme, stop)),
    )
  ) {
    return { eligible: false, code: 'THEME_EVIDENCE_MISSING' };
  }
  return { eligible: true };
}
