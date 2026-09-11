import type { ParsedTripPreference } from '../preferences/preference.types';
import {
  PlaceSearchQueryGenerator,
  generatePlaceSearchQueriesByRole,
} from './place-search-query-generator';

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

  it('prioritizes park, trail, waterfront, and garden queries for a stroll role', () => {
    const preference = {
      area: '홍대',
      startTime: '13:00',
      endTime: '18:00',
      budget: 80_000,
      companions: 'solo',
      pace: 'relaxed',
      interests: ['stroll'],
      preferences: [],
      avoid: [],
    } satisfies ParsedTripPreference;
    const generator = new PlaceSearchQueryGenerator();

    expect(generator.generate(preference, 0)).toEqual(['공원']);
    expect(generator.generate(preference, 1)).toEqual(['산책로']);
    expect(generator.generate(preference, 2)).toEqual(['하천변']);
    expect(generator.generate(preference, 3)).toEqual(['정원']);
  });

  it('keeps role metadata for diagnostics while preserving the legacy query list', () => {
    const preference = {
      area: '홍대',
      startTime: '13:00',
      endTime: '18:00',
      budget: 80_000,
      companions: 'solo',
      pace: 'relaxed',
      interests: ['cafe', 'stroll'],
      preferences: [],
      avoid: [],
    } satisfies ParsedTripPreference;

    expect(generatePlaceSearchQueriesByRole(preference, 1)).toEqual([
      { role: 'cafe', query: '베이커리 카페', variationIndex: 1 },
      { role: 'stroll', query: '산책로', variationIndex: 1 },
    ]);
    expect(new PlaceSearchQueryGenerator().generate(preference, 1)).toEqual([
      '베이커리 카페',
      '산책로',
    ]);
  });

  it('turns explicit visitable preferences into provider queries instead of only ranking hints', () => {
    const preference = {
      area: '서촌',
      startTime: '13:00',
      endTime: '17:00',
      budget: 60_000,
      companions: 'solo',
      pace: 'balanced',
      interests: ['cafe'],
      preferences: ['한옥', '전통'],
      avoid: [],
    } satisfies ParsedTripPreference;

    expect(generatePlaceSearchQueriesByRole(preference)).toEqual([
      { role: 'cafe', query: '카페', variationIndex: 0 },
      { role: 'attraction', query: '한옥', variationIndex: 0 },
      { role: 'culture', query: '전통 공예', variationIndex: 0 },
    ]);
  });
});
