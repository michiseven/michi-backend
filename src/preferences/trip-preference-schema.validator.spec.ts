import { BadGatewayException } from '@nestjs/common';
import { TripPreferenceSchemaValidator } from './trip-preference-schema.validator';

describe('TripPreference JSON Schema', () => {
  const validator = new TripPreferenceSchemaValidator();

  it('accepts a complete structured multi-day preference', () => {
    const value = {
      tripTitle: '서울 2박 3일 여행',
      startDate: '2026-08-29',
      endDate: '2026-08-31',
      totalDays: 3,
      totalBudgetKrw: 240_000,
      partySize: 2,
      companions: 'friends',
      pace: 'relaxed',
      baseCamp: {
        name: '롯데시티호텔 마포',
        checkInTime: '15:00',
        checkOutTime: '11:00',
        dailyReturnTime: '21:30',
      },
      mobilityConstraint: {
        maxWalkMinutesPerLeg: 15,
        avoidSteepInclineOrStairs: true,
        preferredTransit: 'subway',
      },
      userPriorities: ['crowd_avoidance', 'must_visit', 'short_transit'],
      rainFallbackPolicy: 'indoor_switch',
      area: '한남',
      startTime: '13:30',
      endTime: '21:00',
      budget: 80_000,
      interests: ['cafe', 'select_shop', 'meat'],
      preferences: ['quiet'],
      avoid: ['crowded'],
      maxWalkMinutes: 15,
      anchorPlace: null,
      days: [
        {
          dayNumber: 1,
          date: '2026-08-29',
          title: 'Day 1: 한남 & 리움미술관',
          area: '한남',
          startTime: '13:30',
          endTime: '21:00',
          dailyBudgetKrw: 80_000,
          startAnchor: {
            name: '롯데시티호텔 마포',
            targetTime: '13:30',
            role: 'start',
          },
          endAnchor: {
            name: '롯데시티호텔 마포',
            targetTime: '21:00',
            role: 'destination',
          },
          fixedAppointments: [
            {
              name: '리움미술관',
              targetTime: '15:00',
              durationMinutes: 90,
              isMandatory: true,
              category: 'museum',
            },
          ],
          mealWindows: [
            {
              mealType: 'dinner',
              targetTime: '18:30',
              durationMinutes: 90,
              cuisinePreferences: ['korean'],
              area: '한남동',
            },
          ],
          mustVisitPlaces: ['리움미술관'],
          interests: ['art', 'cafe'],
          preferences: ['quiet'],
          avoid: ['crowded'],
          maxWalkMinutes: 15,
          anchorPlace: null,
        },
      ],
    };
    expect(validator.validate(value)).toEqual(value);
  });

  it('rejects malformed time, negative budget, and extra fields', () => {
    expect(() =>
      validator.validate({
        tripTitle: null,
        startDate: null,
        endDate: null,
        totalDays: null,
        totalBudgetKrw: null,
        partySize: null,
        companions: null,
        pace: null,
        baseCamp: null,
        mobilityConstraint: null,
        userPriorities: [],
        rainFallbackPolicy: null,
        area: '성수',
        startTime: '25:00',
        endTime: '21:00',
        budget: -1,
        interests: [],
        preferences: [],
        avoid: [],
        maxWalkMinutes: null,
        anchorPlace: null,
        days: [],
        inventedPlace: '존재하면 안 됨',
      }),
    ).toThrow(BadGatewayException);
  });
});
