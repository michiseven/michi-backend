import type { PlaceSearchRequest, ProviderPlaceRecord } from './place-provider';

export type PlaceSearchAgentAction =
  | { action: 'search'; query: string }
  | { action: 'ask'; question: string }
  | { action: 'finish'; placeKeys: string[] };

export interface PlaceSearchAgentObservation {
  query: string;
  status: 'ok' | 'empty' | 'provider_error' | 'duplicate_query';
  places: Array<{ key: string; name: string; category: string | null; address: string | null }>;
}

export type PlaceSearchAgentResult =
  | {
      status: 'completed';
      places: ProviderPlaceRecord[];
      observations: PlaceSearchAgentObservation[];
    }
  | { status: 'clarify'; question: string; observations: PlaceSearchAgentObservation[] }
  | {
      status: 'failed';
      code: 'CALL_LIMIT' | 'INVALID_ACTION' | 'NO_VERIFIED_RESULTS' | 'MODEL_ERROR';
      observations: PlaceSearchAgentObservation[];
    };

/** Stop awaiting a stalled dependency at the deadline, even when it does not
 * implement AbortSignal. A late read result cannot trigger another action.
 */
function awaitAbortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason as Error);
    signal.addEventListener('abort', abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error as Error);
      },
    );
  });
}

/** A read-only, bounded execution loop. The model chooses actions, never facts.
 * Search must validate spatial/category eligibility before returning records.
 * Route distance, time and itinerary writes remain outside the model loop.
 */
export async function runPlaceSearchAgent(
  request: PlaceSearchRequest,
  decide: (context: {
    request: PlaceSearchRequest;
    observations: PlaceSearchAgentObservation[];
    searchesRemaining: number;
    signal: AbortSignal;
  }) => Promise<PlaceSearchAgentAction>,
  search: (request: PlaceSearchRequest, signal: AbortSignal) => Promise<ProviderPlaceRecord[]>,
  signal: AbortSignal,
): Promise<PlaceSearchAgentResult> {
  const observations: PlaceSearchAgentObservation[] = [];
  const verified = new Map<string, ProviderPlaceRecord>();
  const queried = new Set<string>();
  let searches = 0;
  const failure = (
    code: Extract<PlaceSearchAgentResult, { status: 'failed' }>['code'],
  ): PlaceSearchAgentResult => ({ status: 'failed', code, observations });
  // Decision limit also bounds malformed/repeated calls that execute no search.
  for (let step = 0; step < 6; step++) {
    signal.throwIfAborted();
    let action: PlaceSearchAgentAction;
    try {
      action = await awaitAbortable(
        decide({
          request: { ...request },
          observations: structuredClone(observations),
          searchesRemaining: 3 - searches,
          signal,
        }),
        signal,
      );
    } catch {
      signal.throwIfAborted();
      return failure('MODEL_ERROR');
    }
    signal.throwIfAborted();
    if (action.action === 'ask') {
      const question = action.question.trim();
      return question && question.length <= 500
        ? { status: 'clarify', question, observations }
        : failure('INVALID_ACTION');
    }
    if (action.action === 'finish') {
      if (!Array.isArray(action.placeKeys) || action.placeKeys.length > 10)
        return failure('INVALID_ACTION');
      if (!action.placeKeys.length || action.placeKeys.some((key) => !verified.has(key)))
        return failure('NO_VERIFIED_RESULTS');
      return {
        status: 'completed',
        places: [...new Set(action.placeKeys)].map((key) => verified.get(key)!),
        observations,
      };
    }
    if (action.action !== 'search' || typeof action.query !== 'string')
      return failure('INVALID_ACTION');
    const query = action.query.normalize('NFKC').trim();
    if (!query || query.length > 120) return failure('INVALID_ACTION');
    if (searches >= 3) return failure('CALL_LIMIT');
    if (queried.has(query)) {
      observations.push({ query, status: 'duplicate_query', places: [] });
      continue;
    }
    queried.add(query);
    searches++;
    try {
      // Area, role and result limit belong to the server request. The model
      // cannot replace them with arguments that silently widen constraints.
      const records = await awaitAbortable(
        search({ ...request, query, limit: Math.min(request.limit ?? 10, 10) }, signal),
        signal,
      );
      signal.throwIfAborted();
      const places: PlaceSearchAgentObservation['places'] = [];
      for (const record of records.slice(0, 10)) {
        const key = `${record.provider}:${record.sourcePlaceId}`;
        verified.set(key, record);
        places.push({
          key,
          name: record.name.slice(0, 255),
          category: record.rawCategory?.slice(0, 500) ?? null,
          address: record.roadAddress ?? record.address,
        });
      }
      observations.push({ query, status: places.length ? 'ok' : 'empty', places });
    } catch {
      signal.throwIfAborted();
      // Never expose raw provider exceptions, URLs or credentials to the model.
      observations.push({ query, status: 'provider_error', places: [] });
    }
  }
  return failure('CALL_LIMIT');
}
