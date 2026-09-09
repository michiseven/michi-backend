import { Injectable } from '@nestjs/common';
import type { ParsedTripPreference } from '../preferences/preference.types';

const SEARCH_TERMS: Record<string, string> = {
  cafe: '카페',
  select_shop: '편집샵',
  shopping: '쇼핑',
  meat: '고기 맛집',
  food: '맛집',
  restaurant: '맛집',
  park: '공원',
  stroll: '공원',
  culture: '전시',
  night_view: '야경 명소',
  photography: '사진 명소',
  photo: '사진 명소',
  landmark: '관광 명소',
  attraction: '관광 명소',
  sightseeing: '관광 명소',
  leisure: '놀거리',
};

const SEARCH_TERM_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  cafe: ['카페', '베이커리 카페', '디저트 카페', '로스터리 카페'],
  select_shop: ['편집샵', '소품샵', '라이프스타일샵'],
  shopping: ['쇼핑', '편집샵', '소품샵'],
  meat: ['고기 맛집', '구이 맛집', '한식 고기 맛집'],
  food: ['맛집', '한식 맛집', '로컬 맛집'],
  restaurant: ['맛집', '한식 맛집', '로컬 맛집'],
  park: ['공원', '산책 명소', '정원'],
  // Keep a generic stroll distinct from the explicit park role while searching
  // the park/trail/waterfront/garden vocabulary that can satisfy it.
  stroll: ['공원', '산책로', '하천변', '정원'],
  culture: ['전시', '미술관', '박물관'],
  attraction: ['관광 명소', '역사 명소', '문화 명소'],
  sightseeing: ['관광 명소', '역사 명소', '문화 명소'],
  leisure: ['놀거리', '체험', '문화 체험'],
};

export interface RoleSearchQuery {
  role: string;
  query: string;
  variationIndex: number;
}

export function generatePlaceSearchQueriesByRole(
  preference: ParsedTripPreference,
  variationIndex = 0,
): RoleSearchQuery[] {
  const hasSpecificMealCuisine = Boolean(
    preference.days?.some((day) =>
      day.mealWindows?.some((meal) => (meal.cuisinePreferences?.length ?? 0) > 0),
    ),
  );
  const queries: RoleSearchQuery[] = [];
  const mealQueries =
    preference.days?.flatMap(
      (day) =>
        day.mealWindows?.map((meal) => ({
          role: 'restaurant',
          query: meal.cuisinePreferences?.length
            ? `${meal.cuisinePreferences.join(' ')} 맛집`
            : '맛집',
          variationIndex: 0,
        })) ?? [],
    ) ?? [];
  queries.push(...mealQueries);
  for (const interest of preference.interests) {
    if (hasSpecificMealCuisine && interest === 'restaurant') continue;
    const variants = SEARCH_TERM_VARIANTS[interest];
    const query = variants?.[variationIndex % variants.length] ?? SEARCH_TERMS[interest];
    if (query) queries.push({ role: interest, query, variationIndex });
  }
  if (queries.length === 0) {
    return [
      { role: 'attraction', query: '관광 명소', variationIndex },
      { role: 'cafe', query: '카페', variationIndex },
      { role: 'restaurant', query: '맛집', variationIndex },
    ];
  }
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = `${query.role}:${query.query}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

@Injectable()
export class PlaceSearchQueryGenerator {
  generate(preference: ParsedTripPreference, variationIndex = 0): string[] {
    return [
      ...new Set(
        generatePlaceSearchQueriesByRole(preference, variationIndex).map((item) => item.query),
      ),
    ].slice(0, 5);
  }
}
