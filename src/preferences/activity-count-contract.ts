import type { ActivityCounts, ExplicitRequestContract } from './explicit-request-contract';

export function mergeActivityCounts(...values: Array<ActivityCounts | undefined>): ActivityCounts {
  const result: ActivityCounts = {};
  for (const value of values) {
    for (const [category, count] of Object.entries(value ?? {})) {
      const key = category as keyof ActivityCounts;
      if (count !== undefined) result[key] = Math.max(result[key] ?? 0, count);
    }
  }
  return result;
}

/** Scope comes only from explicit day markers; the LLM cannot move a quota. */
export function extractScopedActivityCounts(
  text: string,
  extract: (text: string) => ActivityCounts | undefined,
): Pick<
  ExplicitRequestContract,
  'requiredActivityCounts' | 'dailyActivityCounts' | 'activityCountsByDay'
> {
  const result: ReturnType<typeof extractScopedActivityCounts> = {};
  let currentDay: number | undefined;
  const marker = /첫(?:째)?\s*날|둘째\s*날|셋째\s*날|제?\s*(\d+)\s*(?:일차|일째|日目)/gu;
  for (const clause of text.split(/[.!?。！？;\n]/u)) {
    const matches = [...clause.matchAll(marker)];
    const sections = matches.length
      ? [
          { text: clause.slice(0, matches[0]!.index), day: currentDay },
          ...matches.map((match, index) => ({
            text: clause.slice(match.index + match[0].length, matches[index + 1]?.index),
            day: match[1]
              ? Number(match[1])
              : /첫/u.test(match[0])
                ? 1
                : /둘/u.test(match[0])
                  ? 2
                  : 3,
          })),
        ]
      : [{ text: clause, day: currentDay }];
    for (const section of sections) {
      currentDay = section.day;
      const counts = extract(section.text);
      if (!counts) continue;
      if (/매\s*일|날마다|하루(?:에|마다)|各日|毎日/u.test(section.text)) {
        result.dailyActivityCounts = mergeActivityCounts(result.dailyActivityCounts, counts);
      } else if (
        /여행\s*전체|전체\s*(?:여행|일정)|통틀어|여행\s*동안|旅行全体|旅行中|合計/u.test(
          section.text,
        )
      ) {
        result.requiredActivityCounts = mergeActivityCounts(result.requiredActivityCounts, counts);
      } else if (section.day !== undefined && section.day > 0) {
        result.activityCountsByDay ??= {};
        result.activityCountsByDay[section.day] = mergeActivityCounts(
          result.activityCountsByDay[section.day],
          counts,
        );
      } else {
        result.requiredActivityCounts = mergeActivityCounts(result.requiredActivityCounts, counts);
      }
    }
  }
  return result;
}

export function requiredActivityCountsForDay(
  contract: ExplicitRequestContract,
  dayNumber: number,
  totalDays: number,
): ActivityCounts {
  return mergeActivityCounts(
    contract.dailyActivityCounts,
    contract.activityCountsByDay?.[dayNumber],
    totalDays === 1 ? contract.requiredActivityCounts : undefined,
  );
}

/** Caller supplies distinct actual place categories, never role labels. */
export function missingActivityCounts(
  counts: ActivityCounts | undefined,
  actualCategories: string[],
): ActivityCounts {
  const missing: ActivityCounts = {};
  for (const [category, minimum] of Object.entries(counts ?? {})) {
    const actual = actualCategories.filter((value) => value === category).length;
    if (minimum !== undefined && actual < minimum)
      missing[category as keyof ActivityCounts] = minimum - actual;
  }
  return missing;
}
