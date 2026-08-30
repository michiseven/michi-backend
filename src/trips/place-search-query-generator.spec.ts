import type { ParsedTripPreference } from '../preferences/preference.types';
import { PlaceSearchQueryGenerator } from './place-search-query-generator';

describe('PlaceSearchQueryGenerator', () => {
  it('uses a specific cuisine query without adding a generic restaurant query', () => {
    const preference = {
      area: '공덕',
      startTime: '13:00',
      endTime: '21:00',
      budget: 80_000,
      companions: 'solo',
      pace: 'relaxed',
      interests: ['cafe', 'culture', 'restaurant'],
      preferences: ['quiet'],
      avoid: ['crowded'],
      days: [
        {
          dayNumber: 1,
          area: '공덕',
          startTime: '13:00',
          endTime: '21:00',
          interests: ['cafe', 'culture', 'restaurant'],
          preferences: ['quiet'],
          avoid: ['crowded'],
          mealWindows: [
            {
              mealType: 'dinner',
              targetTime: '18:30',
              durationMinutes: 60,
              cuisinePreferences: ['한식'],
            },
          ],
        },
      ],
    } satisfies ParsedTripPreference;

    expect(new PlaceSearchQueryGenerator().generate(preference)).toEqual([
      '한식 맛집',
      '카페',
      '전시',
    ]);
  });

  it('rotates broad interest queries across days to expand the live candidate pool', () => {
    const preference = {
      area: '공덕',
      startTime: '13:00',
      endTime: '21:00',
      budget: 70_000,
      companions: 'solo',
      pace: 'relaxed',
      interests: ['cafe', 'restaurant'],
      preferences: ['local'],
      avoid: ['crowded'],
    } satisfies ParsedTripPreference;

    const generator = new PlaceSearchQueryGenerator();

    expect(generator.generate(preference, 0)).toEqual(['카페', '맛집']);
    expect(generator.generate(preference, 1)).toEqual(['베이커리 카페', '한식 맛집']);
    expect(generator.generate(preference, 2)).toEqual(['디저트 카페', '로컬 맛집']);
  });
});
