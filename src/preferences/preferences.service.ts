import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { TRIP_PREFERENCE_PARSER, type TripPreferenceParser } from './preference-parser';
import type {
  DayTripPreference,
  FixedAppointmentPreference,
  MealWindowPreference,
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
  if (/공원|숲|park|forest/u.test(tag)) return 'park';
  if (/한식|고기|식당|restaurant|food|焼肉/u.test(tag)) return 'restaurant';
  return value;
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
  return value;
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

    const totalBudget = input.budget ?? rawPref.totalBudgetKrw ?? rawPref.budget ?? null;
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
      const rawPreferences = existing?.preferences ?? rawPref.preferences ?? [];
      const sourceFixedAppointments =
        existing?.fixedAppointments ??
        (dayNum === 1 ? (firstSourceDay?.fixedAppointments ?? []) : []);
      const sourceMealWindows =
        existing?.mealWindows ?? (dayNum === 1 ? (firstSourceDay?.mealWindows ?? []) : []);
      const mergedMealWindows = mergeMealWindows(
        sourceMealWindows,
        dayNum === 1 ? directMealWindows : [],
      );
      const dayAnchorPlace = existing?.anchorPlace ?? (dayNum === 1 ? rawPref.anchorPlace : null);
      synchronizedDays.push({
        dayNumber: dayNum,
        date: dayDate,
        title: existing?.title ?? `Day ${dayNum}: ${existing?.area ?? resolvedArea} 여행`,
        area: existing?.area ? normalizeSeoulArea(existing.area) : resolvedArea,
        startTime: dayStartTime,
        endTime: dayEndTime,
        dailyBudgetKrw: existing?.dailyBudgetKrw ?? dailyBudget,
        startAnchor:
          existing?.startAnchor ??
          (rawRecord.startAnchor as never) ??
          firstSourceDay?.startAnchor ??
          null,
        endAnchor:
          existing?.endAnchor ??
          (rawRecord.endAnchor as never) ??
          firstSourceDay?.endAnchor ??
          null,
        fixedAppointments: fixedAppointmentsWithDefaults(sourceFixedAppointments, input.text),
        mealWindows: mergedMealWindows,
        mustVisitPlaces:
          existing?.mustVisitPlaces ??
          (dayNum === 1 ? (firstSourceDay?.mustVisitPlaces ?? []) : []),
        interests: [
          ...new Set([
            ...rawInterests.map(normalizedInterest),
            ...(mergedMealWindows.length > 0 ? ['restaurant'] : []),
          ]),
        ],
        preferences: [...new Set([...rawPreferences, ...inferredPreferenceTags(rawInterests)])],
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
      partySize:
        rawPref.partySize ?? (input.text.includes('2') || input.text.includes('둘') ? 2 : 1),
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
    if (validated.startTime >= validated.endTime) {
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
