import { HeuristicRouteOptimizer } from './heuristic-route-optimizer';
import type {
  CandidatePlace,
  OptimizeRouteInput,
  RankedCandidate,
  RouteStopPlan,
  ScoreBreakdown,
} from './ports';
import { RouteConstraintValidator } from './route-constraint-validator';

const breakdown: ScoreBreakdown = {
  total: 0.8,
  preference: 1,
  crowd: 0.5,
  distance: 0.8,
  time: 0.5,
  budget: 0.5,
  diversity: 1,
  area: 1,
};

function candidate(
  id: string,
  category: string,
  longitude: number,
  latitude: number,
  extras: Omit<Partial<RankedCandidate>, 'place'> & { place?: Partial<CandidatePlace> } = {},
): RankedCandidate {
  const { place: placeExtras, ...candidateExtras } = extras;
  const candidatePlace: CandidatePlace = {
    placeId: id,
    source: 'test',
    sourcePlaceId: id,
    name: id,
    category,
    address: '서울특별시 성동구 성수동',
    roadAddress: null,
    location: { type: 'Point', coordinates: [longitude, latitude] },
    district: '성동구',
    rawCategory: category,
    rawPayload: {},
  };
  Object.assign(candidatePlace, placeExtras);
  return {
    place: candidatePlace,
    estimatedCost: null,
    estimatedStayMinutes: 60,
    reason: 'deterministic reason',
    scoreBreakdown: breakdown,
    ...candidateExtras,
  };
}

function input(
  candidates: RankedCandidate[],
  extras: Partial<OptimizeRouteInput> = {},
): OptimizeRouteInput {
  return {
    travelDate: '2026-08-19',
    startTime: '13:00',
    endTime: '21:00',
    budget: 80_000,
    candidates,
    ...extras,
  };
}

function seoulTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

describe('HeuristicRouteOptimizer', () => {
  const optimizer = new HeuristicRouteOptimizer();

  it('plans toward a trip-wide quota without forcing it all into the first day', () => {
    const firstCafe = candidate('first-day-cafe', 'cafe', 126.924, 37.557);
    const firstRoute = optimizer.optimize(
      input([firstCafe], {
        endTime: '14:00',
        priorityActivityCounts: { cafe: 2 },
      }),
    );
    expect(firstRoute.map((stop) => stop.placeId)).toEqual(['first-day-cafe']);
    const secondCafe = candidate('second-day-cafe', 'cafe', 126.925, 37.558);
    const secondRoute = optimizer.optimize(
      input([secondCafe], {
        travelDate: '2026-08-20',
        endTime: '14:00',
        requiredActivityCounts: { cafe: 1 },
      }),
    );
    expect(secondRoute.map((stop) => stop.placeId)).toEqual(['second-day-cafe']);
  });

  it('honors two requested cafe visits before optional high-score diversity stops in a three-hour window', () => {
    const options = [
      candidate('hongdae-cafe-a', 'cafe', 126.924, 37.557, {
        scoreBreakdown: { ...breakdown, total: 0.4 },
      }),
      candidate('hongdae-cafe-b', 'cafe', 126.925, 37.558, {
        scoreBreakdown: { ...breakdown, total: 0.35 },
      }),
      candidate('high-score-culture', 'culture', 126.924, 37.558, {
        scoreBreakdown: { ...breakdown, total: 0.99 },
      }),
      candidate('high-score-shopping', 'shopping', 126.924, 37.557, {
        scoreBreakdown: { ...breakdown, total: 0.98 },
      }),
    ];
    const request = input(options, { endTime: '16:00', requiredActivityCounts: { cafe: 2 } });
    const route = optimizer.optimize(request);
    expect(route.map((stop) => stop.placeId)).toEqual(['hongdae-cafe-a', 'hongdae-cafe-b']);
    expect(route.every((stop) => stop.stopType === 'general')).toBe(true);
    expect(new RouteConstraintValidator().validate(request, route).valid).toBe(true);
  });

  it('keeps a hard lunch and two cafes without fabricating must-visit anchors', () => {
    const cafes = [
      candidate('cafe-a', 'cafe', 126.924, 37.557, { estimatedStayMinutes: 45 }),
      candidate('cafe-b', 'cafe', 126.925, 37.558, { estimatedStayMinutes: 45 }),
    ];
    const lunch = candidate('korean-lunch', 'restaurant', 126.924, 37.558);
    const route = optimizer.optimize(
      input([...cafes, lunch], {
        endTime: '17:00',
        requiredActivityCounts: { cafe: 2 },
        mealWindows: [
          {
            mealType: 'lunch',
            targetTime: '13:00',
            durationMinutes: 60,
            cuisinePreferences: ['한식'],
          },
        ],
      }),
    );
    expect(route.filter((stop) => stop.stopType === 'meal')).toHaveLength(1);
    expect(route.filter((stop) => stop.placeId.startsWith('cafe-'))).toHaveLength(2);
    expect(route.some((stop) => stop.stopType === 'must_visit')).toBe(false);
  });

  it('rejects an impossible quota and applies the same count gate to preserveOrder edits', () => {
    const onlyCafe = candidate('only-cafe', 'cafe', 126.924, 37.557);
    const short = input([onlyCafe], { endTime: '16:00', requiredActivityCounts: { cafe: 2 } });
    expect(optimizer.optimize(short)).toEqual([]);
    expect(optimizer.optimize({ ...short, preserveOrder: true })).toEqual([]);
    const second = candidate('second-cafe', 'cafe', 126.925, 37.558);
    expect(
      optimizer.optimize({ ...short, candidates: [onlyCafe, second], preserveOrder: true }),
    ).toHaveLength(2);
  });

  it('builds a valid geospatial route and puts a 夜は焼肉 candidate in dinner time', () => {
    const meat = candidate('yakiniku', 'restaurant', 127.059, 37.544, {
      place: {
        rawCategory: '음식점>한식>육류,고기요리',
        openingHours: [{ opensAt: '17:00', closesAt: '22:00' }],
      },
      scoreBreakdown: { ...breakdown, total: 0.95 },
      estimatedStayMinutes: 75,
    });
    const cafe = candidate('cafe', 'cafe', 127.044, 37.546, {
      scoreBreakdown: { ...breakdown, total: 0.9 },
    });
    const shop = candidate('shop', 'shopping', 127.05, 37.544, {
      scoreBreakdown: { ...breakdown, total: 0.85 },
    });
    const routeInput = input([meat, cafe, shop]);
    const route = optimizer.optimize(routeInput);

    expect(route).toHaveLength(3);
    expect(route.map((stop) => stop.order)).toEqual([1, 2, 3]);
    const dinner = route.find((stop) => stop.placeId === 'yakiniku');
    expect(dinner).toBeDefined();
    expect(seoulTime(dinner!.arrivalAt) >= '17:30').toBe(true);
    expect(new RouteConstraintValidator().validate(routeInput, route)).toMatchObject({
      valid: true,
    });
  });

  it('preserves a user-edited order while recalculating travel times', () => {
    const requested = [
      candidate('shop', 'shopping', 127.05, 37.544),
      candidate('cafe', 'cafe', 127.044, 37.546),
    ];
    const route = optimizer.optimize(input(requested, { preserveOrder: true }));
    expect(route.map((stop) => stop.placeId)).toEqual(['shop', 'cafe']);
    expect(new Date(route[1]!.arrivalAt).getTime()).toBeGreaterThanOrEqual(
      new Date(route[0]!.leaveAt).getTime(),
    );
  });

  it('uses a supplied mixed subway duration when recalculating a preserved route', () => {
    const requested = [
      candidate('first', 'culture', 127.05, 37.544),
      candidate('second', 'cafe', 127.051, 37.544),
    ];
    const route = optimizer.optimize(
      input(requested, {
        preserveOrder: true,
        legEstimates: {
          'first->second': {
            distanceKm: 5.85,
            durationMinutes: 22,
            method: 'seoul-subway-path-v1',
            evidence: 'mixed',
            transportMode: 'subway',
            disclaimer: 'official subway plus estimated access walk',
          },
        },
      }),
    );

    expect(seoulTime(route[0]!.leaveAt)).toBe('14:00');
    expect(seoulTime(route[1]!.arrivalAt)).toBe('14:22');
  });

  it('aligns to known opening hours, excludes infeasible hours, and does not guess missing hours', () => {
    const opensLater = candidate('opens-later', 'culture', 127.04, 37.54, {
      place: { openingHours: [{ opensAt: '15:00', closesAt: '17:00' }] },
    });
    const closed = candidate('closed', 'cafe', 127.041, 37.541, {
      place: { openingHours: [{ opensAt: '22:00', closesAt: '23:00' }] },
    });
    const unknown = candidate('unknown', 'park', 127.042, 37.542);
    const route = optimizer.optimize(input([opensLater, closed, unknown]));

    expect(route.map((stop) => stop.placeId)).not.toContain('closed');
    expect(route.map((stop) => stop.placeId)).toContain('unknown');
    const known = route.find((stop) => stop.placeId === 'opens-later');
    expect(known).toBeDefined();
    expect(seoulTime(known!.arrivalAt) >= '15:00').toBe(true);
  });

  it('enforces known budget without treating unknown costs as zero-cost facts', () => {
    const expensive = candidate('expensive', 'shopping', 127.04, 37.54, {
      estimatedCost: 100_000,
    });
    const unknown = candidate('unknown', 'cafe', 127.041, 37.541, {
      estimatedCost: null,
    });
    const route = optimizer.optimize(input([expensive, unknown], { budget: 50_000 }));
    expect(route.map((stop) => stop.placeId)).toEqual(['unknown']);
  });

  it('hard-filters candidates exceeding maxWalkDistanceKm or maxWalkMinutes from previous stop', () => {
    // start stop
    const startCafe = candidate('start-cafe', 'cafe', 127.044, 37.546, {
      scoreBreakdown: { ...breakdown, total: 0.99 },
    });
    // near stop: ~100m away (lat +0.001)
    const nearShop = candidate('near-shop', 'shopping', 127.045, 37.5465, {
      scoreBreakdown: { ...breakdown, total: 0.8 },
    });
    // far stop: ~2km away (lat +0.02)
    const farBakery = candidate('far-bakery', 'restaurant', 127.065, 37.566, {
      scoreBreakdown: { ...breakdown, total: 0.95 },
    });

    const route = optimizer.optimize(
      input([startCafe, nearShop, farBakery], {
        maxWalkDistanceKm: 0.5,
        maxWalkMinutes: 7,
      }),
    );

    expect(route.map((stop) => stop.placeId)).toContain('start-cafe');
    expect(route.map((stop) => stop.placeId)).toContain('near-shop');
    expect(route.map((stop) => stop.placeId)).not.toContain('far-bakery');
  });

  it('schedules destination anchor venue as the final stop aligned to targetTime', () => {
    const kspo = candidate('kspo-dome', 'culture', 127.127, 37.519, {
      isAnchor: true,
      estimatedStayMinutes: 30,
      scoreBreakdown: { ...breakdown, total: 1 },
    });
    const bangiCafe = candidate('bangi-cafe', 'cafe', 127.12, 37.515, {
      scoreBreakdown: { ...breakdown, total: 0.9 },
    });
    const bangiFood = candidate('bangi-food', 'restaurant', 127.118, 37.514, {
      scoreBreakdown: { ...breakdown, total: 0.85 },
    });

    const route = optimizer.optimize(
      input([kspo, bangiCafe, bangiFood], {
        startTime: '13:00',
        endTime: '18:00',
        anchorPlaceId: 'kspo-dome',
        anchorTargetTime: '17:30',
        anchorRole: 'destination',
      }),
    );

    expect(route.length).toBeGreaterThanOrEqual(2);
    const lastStop = route[route.length - 1];
    expect(lastStop?.placeId).toBe('kspo-dome');
    expect(seoulTime(lastStop!.arrivalAt)).toBe('17:30');
  });

  it('schedules fixed appointment at exactly 15:00 with 90 minutes stay and stopType=fixed_appointment', () => {
    const leeum = candidate('leeum', 'culture', 126.999, 37.538, {
      place: {
        name: '리움미술관',
        fixedAppointment: true,
        targetTime: '15:00',
      },
      estimatedStayMinutes: 90,
    });
    const cafe = candidate('cafe', 'cafe', 127.001, 37.535, {
      scoreBreakdown: { ...breakdown, total: 0.9 },
    });
    const dinner = candidate('dinner', 'restaurant', 127.003, 37.536, {
      scoreBreakdown: { ...breakdown, total: 0.88 },
    });

    const route = optimizer.optimize(
      input([cafe, leeum, dinner], {
        travelDate: '2026-08-29',
        startTime: '13:00',
        endTime: '20:30',
        fixedAppointments: [
          {
            name: '리움미술관',
            targetTime: '15:00',
            durationMinutes: 90,
            isMandatory: true,
          },
        ],
        mealWindows: [
          {
            mealType: 'dinner',
            targetTime: '19:00',
            durationMinutes: 60,
            cuisinePreferences: ['한식'],
          },
        ],
      }),
    );

    const leeumStop = route.find((s) => s.placeId === 'leeum');
    expect(leeumStop).toBeDefined();
    expect(seoulTime(leeumStop!.arrivalAt)).toBe('15:00');
    expect(seoulTime(leeumStop!.leaveAt)).toBe('16:30');
    expect(leeumStop!.estimatedStayMinutes).toBe(90);
    expect(leeumStop!.stopType).toBe('fixed_appointment');
    const dinnerStop = route.find((s) => s.placeId === 'dinner');
    expect(dinnerStop).toBeDefined();
    expect(seoulTime(dinnerStop!.arrivalAt)).toBe('19:00');

    // Verify monotonic time ordering
    for (let i = 1; i < route.length; i++) {
      expect(new Date(route[i]!.arrivalAt).getTime()).toBeGreaterThanOrEqual(
        new Date(route[i - 1]!.leaveAt).getTime(),
      );
    }
  });

  it('schedules at most one restaurant for one explicit dinner window', () => {
    const firstDinner = candidate('dinner-a', 'restaurant', 127.003, 37.536, {
      scoreBreakdown: { ...breakdown, total: 0.9 },
    });
    const secondDinner = candidate('dinner-b', 'restaurant', 127.004, 37.537, {
      scoreBreakdown: { ...breakdown, total: 0.8 },
    });
    const cafe = candidate('cafe', 'cafe', 127.001, 37.535);

    const route = optimizer.optimize(
      input([firstDinner, secondDinner, cafe], {
        startTime: '16:00',
        endTime: '21:00',
        mealWindows: [
          {
            mealType: 'dinner',
            targetTime: '18:30',
            durationMinutes: 60,
            cuisinePreferences: ['한식'],
          },
        ],
      }),
    );

    expect(route.filter((stop) => stop.stopType === 'meal')).toHaveLength(1);
  });

  it('does not return an itinerary that silently drops an explicit meal window', () => {
    const route = optimizer.optimize(
      input([candidate('cafe', 'cafe', 127.001, 37.535)], {
        startTime: '16:00',
        endTime: '21:00',
        mealWindows: [
          {
            mealType: 'dinner',
            targetTime: '18:30',
            durationMinutes: 60,
            cuisinePreferences: ['한식'],
          },
        ],
      }),
    );

    expect(route).toEqual([]);
  });

  it('never schedules two branches of the same brand/franchise in a single trip', () => {
    const starbucksA = candidate('sb-1', 'cafe', 126.979, 37.567, {
      place: { name: '스타벅스 무교로점' },
      scoreBreakdown: { ...breakdown, total: 0.95 },
    });
    const starbucksB = candidate('sb-2', 'cafe', 126.98, 37.568, {
      place: { name: '스타벅스 무교동점' },
      scoreBreakdown: { ...breakdown, total: 0.94 },
    });
    const museum = candidate('museum', 'culture', 126.977, 37.569, {
      place: { name: '일민미술관' },
      scoreBreakdown: { ...breakdown, total: 0.85 },
    });
    const library = candidate('library', 'culture', 126.978, 37.566, {
      place: { name: '서울도서관' },
      scoreBreakdown: { ...breakdown, total: 0.88 },
    });

    const route = optimizer.optimize(
      input([library, starbucksA, starbucksB, museum], {
        startTime: '14:00',
        endTime: '19:00',
      }),
    );

    const placeNames = route.map(
      (stop) =>
        [library, starbucksA, starbucksB, museum].find((c) => c.place.placeId === stop.placeId)
          ?.place.name,
    );

    // Should only contain ONE Starbucks branch, never both
    const starbucksStops = placeNames.filter((name) => name?.includes('스타벅스'));
    expect(starbucksStops).toHaveLength(1);
  });

  it('avoids consecutive cafe visits when other categories are available', () => {
    const cafeA = candidate('cafe-1', 'cafe', 126.979, 37.567, {
      place: { name: '마일스톤 커피' },
      scoreBreakdown: { ...breakdown, total: 0.9 },
    });
    const cafeB = candidate('cafe-2', 'cafe', 126.98, 37.568, {
      place: { name: '어니언 안국' },
      scoreBreakdown: { ...breakdown, total: 0.89 },
    });
    const culture = candidate('culture-1', 'culture', 126.977, 37.569, {
      place: { name: '일민미술관' },
      scoreBreakdown: { ...breakdown, total: 0.82 },
    });
    const shopping = candidate('shop-1', 'shopping', 126.982, 37.565, {
      place: { name: '명동 편집숍' },
      scoreBreakdown: { ...breakdown, total: 0.8 },
    });

    const route = optimizer.optimize(
      input([cafeA, cafeB, culture, shopping], {
        startTime: '13:00',
        endTime: '18:00',
      }),
    );

    const categories = route.map(
      (stop) =>
        [cafeA, cafeB, culture, shopping].find((c) => c.place.placeId === stop.placeId)?.place
          .category,
    );

    // Check that we never have cafe -> cafe directly adjacent in the route
    for (let i = 0; i < categories.length - 1; i++) {
      if (categories[i] === 'cafe') {
        expect(categories[i + 1]).not.toBe('cafe');
      }
    }
  });
});

describe('RouteConstraintValidator', () => {
  it('does not count wrong source categories, duplicates or invented role labels toward requested cafes', () => {
    const cafe = candidate('cafe', 'cafe', 126.924, 37.557);
    const restaurantNamedCafe = candidate('restaurant', 'cafe', 126.925, 37.558, {
      place: { name: '씨카페', rawCategory: '음식점>양식' },
    });
    const original = input([cafe, restaurantNamedCafe]);
    const route = new HeuristicRouteOptimizer().optimize({ ...original, preserveOrder: true });
    const result = new RouteConstraintValidator().validate(
      { ...original, requiredActivityCounts: { cafe: 2 } },
      route.map((stop) => ({ ...stop, stopType: 'must_visit' })),
    );
    expect(result.valid).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain('REQUIRED_ACTIVITY_COUNT_UNMET');
    const duplicated = new RouteConstraintValidator().validate(
      { ...original, requiredActivityCounts: { cafe: 2 } },
      [route[0]!, { ...route[0]!, order: 2 }],
    );
    expect(duplicated.violations.map((v) => v.code)).toEqual(
      expect.arrayContaining(['DUPLICATE_PLACE', 'REQUIRED_ACTIVITY_COUNT_UNMET']),
    );
  });
  it('reports budget, overlap, and stay-duration violations independently', () => {
    const first = candidate('first', 'cafe', 127.04, 37.54, { estimatedCost: 30_000 });
    const second = candidate('second', 'shopping', 127.041, 37.541, {
      estimatedCost: 30_000,
    });
    const route: RouteStopPlan[] = [
      {
        placeId: 'first',
        order: 1,
        arrivalAt: '2026-08-19T04:00:00.000Z',
        leaveAt: '2026-08-19T05:00:00.000Z',
        estimatedStayMinutes: 60,
        estimatedCost: 30_000,
        reason: 'reason',
        scoreBreakdown: breakdown,
      },
      {
        placeId: 'second',
        order: 2,
        arrivalAt: '2026-08-19T04:30:00.000Z',
        leaveAt: '2026-08-19T05:15:00.000Z',
        estimatedStayMinutes: 60,
        estimatedCost: 30_000,
        reason: 'reason',
        scoreBreakdown: breakdown,
      },
    ];
    const result = new RouteConstraintValidator().validate(
      input([first, second], { budget: 50_000 }),
      route,
    );
    expect(result.valid).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toEqual(
      expect.arrayContaining(['OVERLAPPING_STOPS', 'INVALID_STAY_DURATION', 'BUDGET_EXCEEDED']),
    );
  });
});
