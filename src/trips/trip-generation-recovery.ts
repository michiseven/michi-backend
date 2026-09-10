export const TRIP_RELAXATIONS = ['meal_cuisine', 'search_radius', 'route_constraints'] as const;

export type TripRelaxation = (typeof TRIP_RELAXATIONS)[number];

/** The pipeline stage that made a completed itinerary impossible. */
export type TripGenerationFailureStage = 'candidate' | 'role' | 'area' | 'route';

export interface TripGenerationFailureDiagnostics {
  fetched?: number;
  unique?: number;
  insideAllowedArea?: number;
  eligible?: number;
  excludedByRole?: number;
  provider?: string;
  operation?: string;
  /** Exact required role that failed (for example `stroll`), when known. */
  missingRole?: string;
  /** All roles without an eligible provider candidate at search time. */
  missingRoles?: string[];
  /** Provider failures are retained separately from ordinary no-match roles. */
  providerFailures?: Array<{
    role: string;
    provider: string;
    query: string;
    code?: string | null;
  }>;
}

export interface TripGenerationRecoveryAction {
  id: TripRelaxation;
  label: string;
  requestPatch: { relaxations: TripRelaxation[] };
}

export interface TripGenerationRecovery {
  reason:
    | 'meal_cuisine_unavailable'
    | 'no_candidates'
    | 'route_constraints_infeasible'
    | 'provider_unavailable';
  dayNumber: number;
  area: string;
  stage?: TripGenerationFailureStage;
  affectedRequirement?: string;
  diagnostics?: TripGenerationFailureDiagnostics;
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
  stage?: TripGenerationFailureStage;
  affectedRequirement?: string;
  diagnostics?: TripGenerationFailureDiagnostics;
}): TripGenerationRecovery {
  // Keep the legacy action set when callers have not yet supplied a stage. This
  // makes old clients safe while allowing generation callers to avoid suggesting
  // a relaxation that cannot affect the observed failure.
  const shared = [
    action('search_radius', '인근 지역까지 포함해 다시 찾기'),
    action('route_constraints', '이동 제약을 완화해 다시 계산하기'),
  ];

  if (input.reason === 'meal_cuisine_unavailable') {
    return {
      ...input,
      actions:
        input.stage === 'role'
          ? [
              action('meal_cuisine', '음식 종류 조건 없이 다시 찾기'),
              action('search_radius', '인근 지역까지 포함해 다시 찾기'),
            ]
          : [action('meal_cuisine', '음식 종류 조건 없이 다시 찾기'), ...shared],
    };
  }

  if (input.reason === 'provider_unavailable') {
    return { ...input, actions: [] };
  }

  if (input.stage === 'area') {
    // There is no safe automatic relaxation for an unresolved area boundary.
    // The chat layer turns this into a user-edit chip instead of pretending that
    // a radius retry can establish the requested region.
    return { ...input, actions: [] };
  }
  if (input.stage === 'role') {
    if (input.affectedRequirement === 'theme') {
      return { ...input, actions: [] };
    }
    return { ...input, actions: [action('search_radius', '인근 지역까지 포함해 다시 찾기')] };
  }
  if (input.stage === 'route') {
    return { ...input, actions: [action('route_constraints', '이동 제약을 완화해 다시 계산하기')] };
  }

  return { ...input, actions: shared };
}
