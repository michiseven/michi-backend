import type { MealWindowPreference } from '../preferences/preference.types';
import type { RankedCandidate } from './ports';

export type CuisineCompatibility = 'match' | 'mismatch' | 'unknown';

const KOREAN_MARKERS =
  /한식|한정식|국밥|비빔밥|불고기|삼겹살|갈비|찌개|전골|냉면|설렁탕|곰탕|보쌈|족발|닭갈비|韓国料理|韓国食|korean/iu;
const STRONG_NON_KOREAN_NAME_MARKERS =
  /규카츠|돈카츠|돈까스|스시|초밥|사시미|라멘|우동|소바|이자카야|오마카세|파스타|피자|타코|쌀국수|마라탕|훠궈|딤섬|중식|일식|양식|베트남|태국|멕시칸/iu;
const MEAT_MARKERS = /고기|육류|삼겹살|갈비|불고기|바비큐|바베큐|焼肉|meat|bbq/iu;

function normalizeCuisine(value: string): string {
  if (/한식|한국.*요리|한국.*料理|韓国料理|韓国食|korean/iu.test(value)) return '한식';
  if (/고기|焼肉|meat|bbq/iu.test(value)) return '고기';
  return value.trim().toLowerCase();
}

export function assessCuisineCompatibility(
  candidate: RankedCandidate,
  requestedCuisines: readonly string[],
): CuisineCompatibility {
  if (candidate.place.category !== 'restaurant' || requestedCuisines.length === 0) {
    return 'match';
  }

  const name = candidate.place.name;
  const evidence = `${name} ${candidate.place.rawCategory ?? ''}`;
  let sawKnownCuisine = false;

  for (const requested of requestedCuisines.map(normalizeCuisine)) {
    if (requested === '한식') {
      sawKnownCuisine = true;
      // A specific contradictory dish in the business name is stronger than a broad provider
      // category such as 음식점>한식.
      if (STRONG_NON_KOREAN_NAME_MARKERS.test(name)) continue;
      if (KOREAN_MARKERS.test(evidence)) return 'match';
      continue;
    }
    if (requested === '고기') {
      sawKnownCuisine = true;
      if (MEAT_MARKERS.test(evidence)) return 'match';
      continue;
    }
    if (requested.length > 0 && evidence.toLowerCase().includes(requested)) return 'match';
  }

  return sawKnownCuisine || requestedCuisines.length > 0 ? 'mismatch' : 'unknown';
}

export function filterCandidatesForMealCuisine(
  candidates: RankedCandidate[],
  mealWindows: readonly MealWindowPreference[],
): {
  candidates: RankedCandidate[];
  excludedRestaurantCount: number;
  matchedRestaurantCount: number;
} {
  const requested = [
    ...new Set(mealWindows.flatMap((meal) => meal.cuisinePreferences ?? []).map(normalizeCuisine)),
  ];
  if (requested.length === 0) {
    return {
      candidates,
      excludedRestaurantCount: 0,
      matchedRestaurantCount: candidates.filter(
        (candidate) => candidate.place.category === 'restaurant',
      ).length,
    };
  }

  let excludedRestaurantCount = 0;
  let matchedRestaurantCount = 0;
  const filtered = candidates.filter((candidate) => {
    if (candidate.place.category !== 'restaurant') return true;
    const matches = assessCuisineCompatibility(candidate, requested) === 'match';
    if (matches) matchedRestaurantCount += 1;
    else excludedRestaurantCount += 1;
    return matches;
  });
  return { candidates: filtered, excludedRestaurantCount, matchedRestaurantCount };
}
