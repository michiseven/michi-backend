/** User-requested activity time, never an estimate of a walking route. */
export function explicitStrollDuration(text: string): number | undefined {
  const durations = new Set<number>();
  for (const sentence of text.split(/[.!?。！？\n]/u)) {
    if (
      /산책[^,;]{0,15}(?:싫|안\s*할|하지\s*않)|散歩[^,;]{0,15}(?:しない|したくない)|(?:don't|do not)\s+stroll/iu.test(
        sentence,
      )
    )
      continue;
    const role = '(?:산책|散歩|stroll)';
    const time = '(\\d{1,3})\\s*(분|分|minutes?|mins?)';
    const expression = new RegExp(
      `${role}\\s*(?:은|는|을|를|は|を)?\\s*${time}|${time}\\s*(?:동안|間|of)?\\s*${role}`,
      'giu',
    );
    for (const match of sentence.matchAll(expression)) {
      const duration = Number(match[1] ?? match[3]);
      const after = sentence.slice(match.index + match[0].length);
      if (
        /^\s*(?:미만|이하|이내|이상|이동|도보|以内|以下|以上|未満|walk\b|transit\b)/iu.test(after)
      )
        continue;
      if (Number.isSafeInteger(duration) && duration > 0 && duration <= 600)
        durations.add(duration);
    }
  }
  // Conflicting durations must not be silently collapsed to one value.
  return durations.size === 1 ? [...durations][0] : undefined;
}

export function extractStrollDurationContract(text: string): {
  activityDurations?: { stroll: number };
  activityDurationsByDay?: Record<number, { stroll: number }>;
} {
  const marker = /첫(?:째)?\s*날|둘째\s*날|셋째\s*날|제?\s*(\d+)\s*(?:일차|일째|日目)/gu;
  const matches = [...text.matchAll(marker)];
  const result: ReturnType<typeof extractStrollDurationContract> = {};
  const global = explicitStrollDuration(matches.length ? text.slice(0, matches[0]!.index) : text);
  if (global !== undefined) result.activityDurations = { stroll: global };
  for (const [index, match] of matches.entries()) {
    const day = match[1]
      ? Number(match[1])
      : /첫/u.test(match[0])
        ? 1
        : /둘/u.test(match[0])
          ? 2
          : 3;
    const duration = explicitStrollDuration(
      text.slice(match.index + match[0].length, matches[index + 1]?.index),
    );
    if (day > 0 && duration !== undefined) {
      result.activityDurationsByDay ??= {};
      result.activityDurationsByDay[day] = { stroll: duration };
    }
  }
  return result;
}
