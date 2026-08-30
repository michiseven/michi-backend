export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function roundScore(value: number): number {
  return Number(clampUnit(value).toFixed(6));
}

export function finiteUnit(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? clampUnit(value) : null;
}

export function weightedAvailableScore<K extends string>(
  values: Readonly<Partial<Record<K, number | null>>>,
  weights: Readonly<Record<K, number>>,
): { score: number | null; effectiveWeights: Partial<Record<K, number>> } {
  const available = (Object.keys(weights) as K[]).flatMap((key) => {
    const value = finiteUnit(values[key]);
    const weight = Math.max(0, weights[key]);
    return value === null || weight === 0 ? [] : [{ key, value, weight }];
  });
  const weightTotal = available.reduce((sum, entry) => sum + entry.weight, 0);
  if (weightTotal === 0) return { score: null, effectiveWeights: {} };

  const effectiveWeights: Partial<Record<K, number>> = {};
  let score = 0;
  for (const entry of available) {
    const effectiveWeight = entry.weight / weightTotal;
    effectiveWeights[entry.key] = Number(effectiveWeight.toFixed(8));
    score += entry.value * effectiveWeight;
  }
  return { score: roundScore(score), effectiveWeights };
}
