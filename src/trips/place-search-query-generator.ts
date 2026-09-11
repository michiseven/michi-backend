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
  night_view: ['야경 명소', '전망대', '야경 산책'],
  photography: ['사진 명소', '포토 스팟', '전망 명소'],
  photo: ['사진 명소', '포토 스팟', '전망 명소'],
  live: ['라이브 음악', '공연장', '재즈 바'],
  bar: ['칵테일 바', '재즈 바', '와인 바'],
};

const PREFERENCE_SEARCHES: Readonly<Record<string, { role: string; query: string }>> = {
  한옥: { role: 'attraction', query: '한옥' },
  전통: { role: 'culture', query: '전통 공예' },
  night_view: { role: 'night_view', query: '야경 명소' },
  photography: { role: 'photography', query: '사진 명소' },
  stroll: { role: 'stroll', query: '산책로' },
  live: { role: 'live', query: '라이브 음악' },
  shopping: { role: 'shopping', query: '소품샵' },
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
  for (const preferenceTag of preference.preferences) {
    const search = PREFERENCE_SEARCHES[preferenceTag];
    if (search) queries.push({ ...search, variationIndex });
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
  // Optional keeps lightweight test doubles and older integrations source-compatible.
  readonly generateByRole?: (
    preference: ParsedTripPreference,
    variationIndex?: number,
  ) => RoleSearchQuery[];

  constructor() {
    this.generateByRole = generatePlaceSearchQueriesByRole;
  }

  generate(preference: ParsedTripPreference, variationIndex = 0): string[] {
    const queries = this.generateByRole?.(preference, variationIndex) ?? [];
    return [...new Set(queries.map((item) => item.query))].slice(0, 5);
  }
}
