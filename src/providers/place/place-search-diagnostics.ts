import type {
  PlaceProvider,
  PlaceSearchRequest,
  PlaceSearchResponse,
  ProviderPlaceRecord,
} from './place-provider';

export type PlaceSearchAttemptStatus =
  'ok' | 'empty_response' | 'filtered_out' | 'provider_error' | 'no_eligible_candidate';

export interface PlaceSearchDiagnosticAttempt {
  role: string;
  query: string;
  provider: string;
  providerMode: PlaceSearchResponse['providerMode'] | null;
  fetched: number;
  unique: number;
  insideAllowedArea: number;
  eligible: number;
  status: PlaceSearchAttemptStatus;
  providerError?: {
    code: string | null;
    message: string;
  } | null;
  /** Records are retained for cross-query role-level deduplication only. */
  records?: ProviderPlaceRecord[];
  insidePlaceIds?: string[];
  eligiblePlaceIds?: string[];
}

export interface PlaceSearchRoleDiagnostic {
  role: string;
  fetched: number;
  unique: number;
  insideAllowedArea: number;
  eligible: number;
  attempts: PlaceSearchDiagnosticAttempt[];
  status: 'satisfied' | 'missing' | 'provider_error';
}

export interface PlaceSearchDiagnostics {
  roles: PlaceSearchRoleDiagnostic[];
  missingRoles: string[];
  providerFailures: PlaceSearchDiagnosticAttempt[];
}

export interface PlaceSearchRecordEvaluation {
  insideAllowedArea: boolean;
  eligible: boolean;
}

function errorDetails(error: unknown): { code: string | null; message: string } {
  if (error && typeof error === 'object') {
    const response = 'response' in error ? (error as { response?: unknown }).response : undefined;
    if (response && typeof response === 'object') {
      const code = 'code' in response && typeof response.code === 'string' ? response.code : null;
      const message =
        'message' in response && typeof response.message === 'string'
          ? response.message
          : error instanceof Error
            ? error.message
            : 'place provider request failed';
      return { code, message };
    }
  }
  return {
    code: null,
    message: error instanceof Error ? error.message : 'place provider request failed',
  };
}

function statusForResponse(
  response: PlaceSearchResponse,
  eligible: number,
): PlaceSearchAttemptStatus {
  if (response.places.length === 0) {
    return (
      response.diagnostics?.status ??
      (response.diagnostics?.fetched ? 'filtered_out' : 'empty_response')
    );
  }
  return eligible > 0 ? 'ok' : 'no_eligible_candidate';
}

/** Run one role/query search without conflating provider failure and no matches. */
export async function searchPlaceWithDiagnostics(
  provider: PlaceProvider,
  request: PlaceSearchRequest,
  role: string,
  evaluate: (record: ProviderPlaceRecord) => PlaceSearchRecordEvaluation = () => ({
    insideAllowedArea: true,
    eligible: true,
  }),
): Promise<PlaceSearchDiagnosticAttempt> {
  try {
    const response = await provider.search(request);
    const uniqueRecords = new Map(
      response.places.map((record) => [`${record.provider}:${record.sourcePlaceId}`, record]),
    );
    let insideAllowedArea = 0;
    let eligible = 0;
    const insidePlaceIds: string[] = [];
    const eligiblePlaceIds: string[] = [];
    for (const record of uniqueRecords.values()) {
      const result = evaluate(record);
      const placeId = `${record.provider}:${record.sourcePlaceId}`;
      if (result.insideAllowedArea) {
        insideAllowedArea += 1;
        insidePlaceIds.push(placeId);
      }
      if (result.eligible) {
        eligible += 1;
        eligiblePlaceIds.push(placeId);
      }
    }
    return {
      role,
      query: response.query,
      provider: response.provider,
      providerMode: response.providerMode,
      fetched: response.diagnostics?.fetched ?? response.places.length,
      unique: uniqueRecords.size,
      insideAllowedArea,
      eligible,
      status: statusForResponse(response, eligible),
      providerError: null,
      records: [...uniqueRecords.values()],
      insidePlaceIds,
      eligiblePlaceIds,
    };
  } catch (error) {
    const details = errorDetails(error);
    return {
      role,
      query: request.query,
      provider: provider.name,
      providerMode: provider.mode,
      fetched: 0,
      unique: 0,
      insideAllowedArea: 0,
      eligible: 0,
      status: 'provider_error',
      providerError: details,
      records: [],
      insidePlaceIds: [],
      eligiblePlaceIds: [],
    };
  }
}

/** Aggregate query variants by role. A role is missing only when no eligible
 * candidate was found; fewer results than an internal target is not failure. */
export function summarizePlaceSearchDiagnostics(
  attempts: PlaceSearchDiagnosticAttempt[],
  requiredRoles: readonly string[] = [...new Set(attempts.map((attempt) => attempt.role))],
): PlaceSearchDiagnostics {
  const roles = requiredRoles.map((role): PlaceSearchRoleDiagnostic => {
    const roleAttempts = attempts.filter((attempt) => attempt.role === role);
    const records = new Set(
      roleAttempts.flatMap((attempt) =>
        (attempt.records ?? []).map((record) => `${record.provider}:${record.sourcePlaceId}`),
      ),
    );
    const hasProviderError = roleAttempts.some((attempt) => attempt.status === 'provider_error');
    const eligible = new Set(roleAttempts.flatMap((attempt) => attempt.eligiblePlaceIds ?? []));
    const inside = new Set(roleAttempts.flatMap((attempt) => attempt.insidePlaceIds ?? []));
    const fetched = roleAttempts.reduce((sum, attempt) => sum + attempt.fetched, 0);
    return {
      role,
      fetched,
      unique: records.size,
      insideAllowedArea: inside.size,
      eligible: eligible.size,
      attempts: roleAttempts,
      status: eligible.size > 0 ? 'satisfied' : hasProviderError ? 'provider_error' : 'missing',
    };
  });
  return {
    roles,
    missingRoles: roles.filter((role) => role.status === 'missing').map((role) => role.role),
    providerFailures: attempts.filter((attempt) => attempt.status === 'provider_error'),
  };
}
