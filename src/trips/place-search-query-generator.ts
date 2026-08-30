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
  culture: ['전시', '미술관', '박물관'],
  attraction: ['관광 명소', '역사 명소', '문화 명소'],
  sightseeing: ['관광 명소', '역사 명소', '문화 명소'],
  leisure: ['놀거리', '체험', '문화 체험'],
};

@Injectable()
export class PlaceSearchQueryGenerator {
  generate(preference: ParsedTripPreference, variationIndex = 0): string[] {
    const hasSpecificMealCuisine = Boolean(
      preference.days?.some((day) =>
        day.mealWindows?.some((meal) => (meal.cuisinePreferences?.length ?? 0) > 0),
      ),
    );
    const interestQueries = preference.interests
      .filter((interest) => !(hasSpecificMealCuisine && interest === 'restaurant'))
      .map((interest) => {
        const variants = SEARCH_TERM_VARIANTS[interest];
        return variants?.[variationIndex % variants.length] ?? SEARCH_TERMS[interest];
      })
      .filter((query): query is string => Boolean(query));
    const mealQueries =
      preference.days?.flatMap(
        (day) =>
          day.mealWindows?.map((meal) =>
            meal.cuisinePreferences?.length ? `${meal.cuisinePreferences.join(' ')} 맛집` : '맛집',
          ) ?? [],
      ) ?? [];
    const queries = [...mealQueries, ...interestQueries];
    return [...new Set(queries)].slice(0, 5).length > 0
      ? [...new Set(queries)].slice(0, 5)
      : ['관광 명소', '카페', '맛집'];
  }
}
