export const TRIP_RELAXATIONS = ['meal_cuisine', 'search_radius', 'route_constraints'] as const;

export type TripRelaxation = (typeof TRIP_RELAXATIONS)[number];

export interface TripGenerationRecoveryAction {
  id: TripRelaxation;
  label: string;
  requestPatch: { relaxations: TripRelaxation[] };
}

export interface TripGenerationRecovery {
  reason: 'meal_cuisine_unavailable' | 'no_candidates' | 'route_constraints_infeasible';
  dayNumber: number;
  area: string;
  actions: TripGenerationRecoveryAction[];
}

function action(id: TripRelaxation, label: string): TripGenerationRecoveryAction {
  return { id, label, requestPatch: { relaxations: [id] } };
}

/**
 * Additive error metadata that lets a client re-submit the same request only
 * after the user chooses a specific relaxation. The server never invents a
 * replacement place or silently weakens a condition.
 */
export function tripGenerationRecovery(input: {
  reason: TripGenerationRecovery['reason'];
  dayNumber: number;
  area: string;
}): TripGenerationRecovery {
  const shared = [
    action('search_radius', '인근 지역까지 포함해 다시 찾기'),
    action('route_constraints', '이동 제약을 완화해 다시 계산하기'),
  ];

  if (input.reason === 'meal_cuisine_unavailable') {
    return {
      ...input,
      actions: [action('meal_cuisine', '음식 종류 조건 없이 다시 찾기'), ...shared],
    };
  }

  return { ...input, actions: shared };
}
