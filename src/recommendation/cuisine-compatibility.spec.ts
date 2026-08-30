import type { RankedCandidate } from './ports';
import {
  assessCuisineCompatibility,
  filterCandidatesForMealCuisine,
} from './cuisine-compatibility';

function restaurant(name: string, rawCategory: string | null): RankedCandidate {
  return {
    place: {
      placeId: name,
      source: 'naver-local',
      sourcePlaceId: name,
      name,
      category: 'restaurant',
      address: '서울',
      roadAddress: null,
      location: { type: 'Point', coordinates: [126.95, 37.54] },
      district: '마포구',
      rawCategory,
      rawPayload: {},
    },
    estimatedCost: null,
    estimatedStayMinutes: 60,
    reason: 'test',
    scoreBreakdown: {
      total: 0.8,
      preference: 1,
      crowd: 0.5,
      distance: 0.5,
      time: 0.5,
      budget: 0.5,
      diversity: 0.5,
      area: 1,
    },
  };
}

describe('cuisine compatibility', () => {
  it('rejects a strong Japanese dish name even when NAVER broadly classifies it as Korean', () => {
    expect(
      assessCuisineCompatibility(restaurant('프리미엄 규카츠 규도 마포공덕 본점', '음식점>한식'), [
        '한식',
      ]),
    ).toBe('mismatch');
  });

  it('accepts provider-backed Korean restaurants without contradictory name evidence', () => {
    expect(assessCuisineCompatibility(restaurant('마포옥', '음식점>한식'), ['한식'])).toBe('match');
  });

  it('keeps non-restaurants and removes cuisine-mismatched restaurants', () => {
    const cafe = restaurant('공덕 카페', '카페');
    cafe.place.category = 'cafe';
    const result = filterCandidatesForMealCuisine(
      [cafe, restaurant('마포옥', '음식점>한식'), restaurant('공덕 스시', '음식점>한식')],
      [
        {
          mealType: 'dinner',
          targetTime: '18:30',
          durationMinutes: 60,
          cuisinePreferences: ['한식'],
        },
      ],
    );

    expect(result.candidates.map((candidate) => candidate.place.name)).toEqual([
      '공덕 카페',
      '마포옥',
    ]);
    expect(result.excludedRestaurantCount).toBe(1);
    expect(result.matchedRestaurantCount).toBe(1);
  });
});
