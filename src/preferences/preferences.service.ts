import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { TRIP_PREFERENCE_PARSER, type TripPreferenceParser } from './preference-parser';
import type {
  DayTripPreference,
  FixedAppointmentPreference,
  MealWindowPreference,
  MealCuisine,
  ParsedTripPreference,
  PreferenceParseInput,
  PreferenceParseResult,
} from './preference.types';
import { normalizeSeoulArea } from './seoul-area-normalizer';
import { TripPreferenceSchemaValidator } from './trip-preference-schema.validator';

function addDaysSafe(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(year!, month! - 1, day! + days));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function diffDaysSafe(startDate: string, endDate: string): number {
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = endDate.split('-').map(Number);
  const ms1 = Date.UTC(y1!, m1! - 1, d1);
  const ms2 = Date.UTC(y2!, m2! - 1, d2);
  return Math.round((ms2 - ms1) / (86400 * 1000));
}

function normalizedInterest(value: string): string {
  const tag = value.toLowerCase();
  if (/카페|cafe|coffee|喫茶/u.test(tag)) return 'cafe';
  if (/편집|독립 상점|상점|쇼핑|shop|select/u.test(tag)) return 'shopping';
  if (/미술|박물|전시|gallery|museum|ギャラリー/u.test(tag)) return 'culture';
  if (/한옥|韓屋|hanok|전통|伝統|역사|歴史/u.test(tag)) return 'culture';
  if (/사진|写真|photo|撮影/u.test(tag)) return 'photography';
  if (/야경|夜景|night\s*view/u.test(tag)) return 'night_view';
  if (/라이브|live|음악|音楽/u.test(tag)) return 'live';
  if (/바|bar|バー|펍|pub|칵테일/u.test(tag)) return 'bar';
  if (/공원|숲|park|forest/u.test(tag)) return 'park';
  if (
    /산책|散歩|stroll|walking[_ ]?trail|riverside|하천|강변|정원|식물원|garden|botanical/u.test(tag)
  )
    return 'stroll';
  if (/한식|고기|식당|restaurant|food|焼肉/u.test(tag)) return 'restaurant';
  return value;
}

function isStrollDislike(text: string): boolean {
  return /(산책|散歩|stroll)[^.!?。！？]{0,12}(?:싫|안\s*좋|좋아하지|좋지\s*않|したくない|好きじゃない|好きではない|嫌|苦手|dislike|hate|don't\s+(?:like|want))/iu.test(
    text,
  );
}

function inferredPreferenceTags(values: string[]): string[] {
  const tags = new Set<string>();
  for (const value of values) {
    if (/조용|quiet|静か/u.test(value.toLowerCase())) tags.add('quiet');
    if (/독립|로컬|local|個人/u.test(value.toLowerCase())) tags.add('local');
  }
  return [...tags];
}

function explicitPreferredTransit(text: string): 'subway' | 'bus' | 'walk' | 'taxi' | null {
  const patterns: Array<['subway' | 'bus' | 'walk' | 'taxi', RegExp]> = [
    ['subway', /지하철|地下鉄|\bsubway\b|\bmetro\b/iu],
    ['bus', /버스|バス|\bbus\b/iu],
    ['taxi', /택시|タクシー|\btaxi\b/iu],
    ['walk', /도보|걸어서|徒歩|歩いて|\bwalk(?:ing)?\b/iu],
  ];
  return patterns.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

const DEFAULT_FIXED_APPOINTMENT_DURATION_MINUTES = 60;

function sameAreaName(value: string, area: string): boolean {
  try {
    return normalizeSeoulArea(value) === normalizeSeoulArea(area);
  } catch {
    return false;
  }
}

function isGenericAreaHotelAnchor(
  anchor: { name: string } | null | undefined,
  area: string,
): boolean {
  if (!anchor || !/호텔|hotel|ホテル|숙소|宿/u.test(anchor.name)) return false;
  const withoutHotel = anchor.name.replace(/호텔|hotel|ホテル|숙소|宿/giu, '').trim();
  return withoutHotel.length === 0 || sameAreaName(withoutHotel, area);
}

function explicitMealWindows(text: string): MealWindowPreference[] {
  const windows: MealWindowPreference[] = [];
  const cuisinePreferences = /한식|韓国料理|韓国食/iu.test(text)
    ? ['한식']
    : /고기|焼肉|meat/iu.test(text)
      ? ['고기']
      : [];
  if (/점심|중식|昼食|ランチ|\blunch\b/iu.test(text)) {
    windows.push({
      mealType: 'lunch',
      targetTime: '12:30',
      durationMinutes: 60,
      cuisinePreferences,
      area: null,
    });
  }
  if (/저녁|석식|夕食|ディナー|\bdinner\b/iu.test(text)) {
    windows.push({
      mealType: 'dinner',
      targetTime: '18:30',
      durationMinutes: 60,
      cuisinePreferences,
      area: null,
    });
  }
  return windows;
}

function normalizedCuisine(value: string): string {
  if (/한식|한국.*요리|한국.*料理|韓国料理|韓国食|korean/iu.test(value)) return '한식';
  if (/고기|焼肉|meat/iu.test(value)) return '고기';
  if (/일식|일본.*요리|日本料理|和食|japanese/iu.test(value)) return '일식';
  if (/중식|중국.*요리|中国料理|chinese/iu.test(value)) return '중식';
  if (/양식|서양.*요리|洋食|western/iu.test(value)) return '양식';
  if (/카페.*디저트|cafe.*dessert|カフェ.*スイーツ/iu.test(value)) return '카페디저트';
  return value;
}

function minutesAt(time: string): number {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function hasExplicitTimeRange(text: string): boolean {
  return /(?:\d{1,2}\s*(?:시|時)|\d{1,2}:\d{2})\s*(?:~|〜|[-–])\s*(?:\d{1,2}\s*(?:시|時)|\d{1,2}:\d{2})/u.test(
    text,
  );
}

/**
 * The LLM sometimes leaves its generic 13:00–17:00 default in place while
 * also extracting an explicit dinner at 18:30. That is an internally
 * impossible contract, not a user choice. Only when the user did not state a
 * time range do we extend that inferred end time to include the promised meal.
 */
function endTimeCoveringMeals(
  currentEndTime: string,
  meals: readonly MealWindowPreference[],
  input: PreferenceParseInput,
): string {
  if (input.endTime || hasExplicitTimeRange(input.text)) return currentEndTime;
  const latestMealEnd = Math.max(
    ...meals.map((meal) => minutesAt(meal.targetTime) + meal.durationMinutes),
    0,
  );
  if (minutesAt(currentEndTime) >= latestMealEnd) return currentEndTime;
  // A dinner needs time to finish and should not be clipped at its target.
  if (latestMealEnd >= 18 * 60) {
    return /라이브|live|음악|音楽|바|bar|バー|펍|pub|칵테일/iu.test(input.text) ? '23:00' : '20:30';
  }
  return currentEndTime;
}

/** Preserve visitable themes stated in the user's own text even if a live
 * parser returns a broad category only. These are later searched and verified;
 * operational preferences (quiet, stroller, rain) deliberately stay absent. */
function explicitVisitablePreferences(text: string): string[] {
  const tags: string[] = [];
  if (/한옥|韓屋|hanok/iu.test(text)) tags.push('한옥');
  if (/전통|伝統|역사|歴史/iu.test(text)) tags.push('전통');
  if (/야경|夜景|night\s*view/iu.test(text)) tags.push('night_view');
  if (/사진|写真|photo|撮影/iu.test(text)) tags.push('photography');
  if (/산책|散歩|stroll/iu.test(text)) tags.push('stroll');
  if (/라이브|live|음악|音楽/iu.test(text)) tags.push('live');
  if (/쇼핑|shopping|買い物|雑貨/iu.test(text)) tags.push('shopping');
  return tags;
}

function selectedCuisine(value: MealCuisine): string {
  return {
    korean: '한식',
    japanese: '일식',
    chinese: '중식',
    western: '양식',
    cafe_dessert: '카페디저트',
  }[value];
}

function mergeMealWindows(
  source: MealWindowPreference[],
  explicit: MealWindowPreference[],
): MealWindowPreference[] {
  const merged = source.map((meal) => {
    const direct = explicit.find((candidate) => candidate.mealType === meal.mealType);
    return {
      ...meal,
      cuisinePreferences: [
        ...new Set([
          ...(meal.cuisinePreferences ?? []).map(normalizedCuisine),
          ...(direct?.cuisinePreferences ?? []).map(normalizedCuisine),
        ]),
      ],
    };
  });
  return [
    ...merged,
    ...explicit.filter((direct) => !merged.some((meal) => meal.mealType === direct.mealType)),
  ];
}

function fixedAppointmentsWithDefaults(
  appointments: FixedAppointmentPreference[],
  text: string,
): FixedAppointmentPreference[] {
  const hasExplicitStayDuration =
    /\d+\s*(?:분|分|minutes?|mins?|시간|時間|hours?)\s*(?:정도\s*)?(?:머물|관람|체류|滞在|見学|visit|stay)/iu.test(
      text,
    ) ||
    /(?:머물|관람|체류|滞在|見学|visit|stay)[^.!?。！？]{0,20}\d+\s*(?:분|分|minutes?|mins?|시간|時間|hours?)/iu.test(
      text,
    );
  return appointments.map((appointment) => ({
    ...appointment,
    durationMinutes: hasExplicitStayDuration
      ? appointment.durationMinutes
      : DEFAULT_FIXED_APPOINTMENT_DURATION_MINUTES,
  }));
}

@Injectable()
export class PreferencesService {
  constructor(
    @Inject(TRIP_PREFERENCE_PARSER) private readonly parser: TripPreferenceParser,
    private readonly schema: TripPreferenceSchemaValidator,
  ) {}

  async parse(input: PreferenceParseInput): Promise<PreferenceParseResult> {
    if (input.startArea) {
      normalizeSeoulArea(input.startArea);
    }
    const result = await this.parser.parse(input);
    const rawPref = result.preference;
    const rawRecord = rawPref as unknown as Record<string, unknown>;

    const todaySeoul = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    let rawStartDate = input.startDate ?? rawPref.startDate ?? input.travelDate ?? todaySeoul;
    let rawEndDate = input.endDate ?? rawPref.endDate ?? null;
    const additionalWarnings: string[] = [];
    if (rawStartDate < todaySeoul) {
      additionalWarnings.push(
        `선택된 여행 시작일(${rawStartDate})이 오늘(${todaySeoul})보다 과거이므로, 일정을 오늘(${todaySeoul}) 기준으로 자동 보정했습니다.`,
      );
      if (rawEndDate && rawEndDate >= rawStartDate) {
        const diff = diffDaysSafe(rawStartDate, rawEndDate);
        rawEndDate = addDaysSafe(todaySeoul, diff);
      }
      rawStartDate = todaySeoul;
    }
    const startDate = rawStartDate;
    let totalDays =
      rawPref.totalDays ?? (rawPref.days && rawPref.days.length > 0 ? rawPref.days.length : 1);
    let endDate = rawEndDate;

    if (input.startDate && input.endDate) {
      const diff = diffDaysSafe(input.startDate, input.endDate);
      if (diff >= 0) {
        totalDays = diff + 1;
        endDate = input.endDate;
      }
    } else if (!endDate || endDate < startDate) {
      endDate = totalDays > 1 ? addDaysSafe(startDate, totalDays - 1) : startDate;
    }

    const resolvedPartySize =
      input.partySize ??
      rawPref.partySize ??
      (input.text.includes('2') || input.text.includes('둘') ? 2 : 1);
    const requestedBudget = input.budget ?? rawPref.totalBudgetKrw ?? rawPref.budget ?? null;
    const totalBudget =
      input.budget !== undefined && input.budgetScope === 'per_person'
        ? input.budget * resolvedPartySize
        : requestedBudget;
    const dailyBudget = totalBudget ? Math.round(totalBudget / totalDays) : null;
    const resolvedArea = normalizeSeoulArea(input.startArea ?? rawPref.area ?? '서울');
    const preferredTransit =
      explicitPreferredTransit(input.text) ?? rawPref.mobilityConstraint?.preferredTransit ?? null;
    const directMealWindows = explicitMealWindows(input.text);

    // 2. Synchronize days array deterministically
    const synchronizedDays: DayTripPreference[] = [];
    const sourceDays = rawPref.days && rawPref.days.length > 0 ? rawPref.days : [];
    const firstSourceDay = sourceDays[0];

    for (let i = 0; i < totalDays; i++) {
      const dayNum = i + 1;
      const dayDate = addDaysSafe(startDate, i);
      const existing = sourceDays[i];

      const dayStartTime =
        dayNum === 1
          ? (input.startTime ?? existing?.startTime ?? rawPref.startTime ?? '13:00')
          : (existing?.startTime ?? '10:30');

      const dayEndTime =
        dayNum === totalDays
          ? (input.endTime ?? existing?.endTime ?? rawPref.endTime ?? '20:30')
          : (existing?.endTime ?? '21:00');

      const rawInterests = existing?.interests ?? rawPref.interests ?? ['cafe', 'culture'];
      const normalizedRawInterests = rawInterests
        .map(normalizedInterest)
        .filter((interest) => !(interest === 'stroll' && isStrollDislike(input.text)));
      const rawPreferences = existing?.preferences ?? rawPref.preferences ?? [];
      const sourceFixedAppointments =
        existing?.fixedAppointments ??
        (dayNum === 1 ? (firstSourceDay?.fixedAppointments ?? []) : []);
      const sourceMealWindows =
        existing?.mealWindows ?? (dayNum === 1 ? (firstSourceDay?.mealWindows ?? []) : []);
      const mergedMealWindows = mergeMealWindows(
        sourceMealWindows,
        dayNum === 1 ? directMealWindows : [],
      ).map((meal) => {
        if (input.mealPreference === 'local_specialty') {
          return { ...meal, cuisinePreferences: [] };
        }
        // A clarification selection changes only the cuisine of an existing
        // meal promise. It never appends a dinner or replaces the source text.
        if (input.mealCuisine) {
          return { ...meal, cuisinePreferences: [selectedCuisine(input.mealCuisine)] };
        }
        return meal;
      });
      const reconciledEndTime = endTimeCoveringMeals(dayEndTime, mergedMealWindows, input);
      const dayAnchorPlace = existing?.anchorPlace ?? (dayNum === 1 ? rawPref.anchorPlace : null);
      synchronizedDays.push({
        dayNumber: dayNum,
        date: dayDate,
        title: existing?.title ?? `Day ${dayNum}: ${existing?.area ?? resolvedArea} 여행`,
        area: existing?.area ? normalizeSeoulArea(existing.area) : resolvedArea,
        startTime: dayStartTime,
        endTime: reconciledEndTime,
        dailyBudgetKrw: existing?.dailyBudgetKrw ?? dailyBudget,
        startAnchor:
          existing?.startAnchor ??
          (rawRecord.startAnchor as never) ??
          firstSourceDay?.startAnchor ??
          null,
        endAnchor: ((): DayTripPreference['endAnchor'] => {
          const anchor =
            existing?.endAnchor ??
            (rawRecord.endAnchor as never) ??
            firstSourceDay?.endAnchor ??
            null;
          return isGenericAreaHotelAnchor(anchor, existing?.area ?? resolvedArea ?? '서울')
            ? null
            : anchor;
        })(),
        fixedAppointments: fixedAppointmentsWithDefaults(sourceFixedAppointments, input.text),
        mealWindows: mergedMealWindows,
        mustVisitPlaces:
          existing?.mustVisitPlaces ??
          (dayNum === 1 ? (firstSourceDay?.mustVisitPlaces ?? []) : []),
        interests: [
          ...new Set([
            // A cuisine clarification is authoritative for a meal window. In
            // particular, 카페·디저트 is a valid meal choice in this product;
            // keeping the parser's generic restaurant role here would require
            // both a cafe and a restaurant for one selected meal.
            ...(input.mealCuisine === 'cafe_dessert'
              ? normalizedRawInterests.filter((interest) => interest !== 'restaurant')
              : normalizedRawInterests),
            ...(input.mealCuisine === 'cafe_dessert' ? ['cafe'] : []),
            ...(mergedMealWindows.some((meal) => !meal.cuisinePreferences?.includes('카페디저트'))
              ? ['restaurant']
              : []),
          ]),
        ],
        preferences: [
          ...new Set([
            ...rawPreferences,
            ...inferredPreferenceTags(rawInterests),
            ...explicitVisitablePreferences(input.text),
            ...(input.mealPreference === 'local_specialty' ? ['local'] : []),
          ]),
        ],
        avoid: existing?.avoid ?? rawPref.avoid ?? ['crowded'],
        maxWalkMinutes: existing?.maxWalkMinutes ?? rawPref.maxWalkMinutes ?? null,
        anchorPlace:
          dayAnchorPlace?.name && resolvedArea && sameAreaName(dayAnchorPlace.name, resolvedArea)
            ? null
            : dayAnchorPlace,
      });
    }

    const firstDay = synchronizedDays[0];
    const preference: ParsedTripPreference = {
      ...rawPref,
      tripTitle: totalDays > 1 ? `서울 ${totalDays}일 맞춤 여행` : `${resolvedArea} 하루 여행`,
      startDate,
      endDate: endDate ?? startDate,
      totalDays,
      totalBudgetKrw: totalBudget,
      partySize: resolvedPartySize,
      companions:
        input.companions === 'with_children'
          ? 'family'
          : (input.companions ?? rawPref.companions ?? null),
      pace: input.pace === 'standard' ? 'balanced' : (input.pace ?? rawPref.pace ?? null),
      area: resolvedArea,
      startTime: input.startTime ?? firstDay?.startTime ?? rawPref.startTime ?? '13:00',
      endTime: input.endTime ?? firstDay?.endTime ?? rawPref.endTime ?? '20:30',
      budget: totalBudget,
      interests: [...new Set(synchronizedDays.flatMap((day) => day.interests))],
      anchorPlace:
        rawPref.anchorPlace?.name &&
        resolvedArea &&
        sameAreaName(rawPref.anchorPlace.name, resolvedArea)
          ? null
          : rawPref.anchorPlace,
      mobilityConstraint:
        preferredTransit === null && !rawPref.mobilityConstraint
          ? null
          : {
              maxWalkMinutesPerLeg:
                rawPref.mobilityConstraint?.maxWalkMinutesPerLeg ?? rawPref.maxWalkMinutes ?? 25,
              avoidSteepInclineOrStairs:
                rawPref.mobilityConstraint?.avoidSteepInclineOrStairs ?? false,
              preferredTransit,
            },
      days: synchronizedDays,
    };

    const validated = this.schema.validate(preference);
    // 다일 여행에서는 첫날 입국 시각과 마지막 날 출국 시각을 비교할 수 없다.
    // 같은 날짜의 하루 일정일 때만 종료 시각이 시작 시각보다 늦어야 한다.
    if (validated.startDate === validated.endDate && validated.startTime >= validated.endTime) {
      throw new BadRequestException({
        code: 'INVALID_TIME_WINDOW',
        message: 'endTime must be later than startTime',
      });
    }

    return {
      ...result,
      preference: validated,
      warnings: [...result.warnings, ...additionalWarnings],
    };
  }
}
