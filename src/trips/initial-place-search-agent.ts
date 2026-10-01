import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { PlaceSearchAgentService } from '../providers/place/place-search-agent.service';
import type { PlaceProvider, PlaceSearchRequest } from '../providers/place/place-provider';
import {
  searchPlaceWithDiagnostics,
  type PlaceSearchDiagnosticAttempt,
} from '../providers/place/place-search-diagnostics';

export class PlaceSearchAgentQuestion extends UnprocessableEntityException {
  constructor(readonly question: string) {
    super({ code: 'PLACE_SEARCH_QUESTION', message: question });
  }
}

/** Replace exactly one search decision process; all returned records still
 * enter normal persistence, spatial/category, scoring and route validation. */
export async function searchInitialPlaceWithAgent(
  provider: PlaceProvider,
  request: PlaceSearchRequest,
  agent: Pick<PlaceSearchAgentService, 'searchVerified'>,
  locale: 'ko' | 'ja',
): Promise<PlaceSearchDiagnosticAttempt> {
  const result = await agent.searchVerified(request, locale);
  if (result.status === 'clarify') throw new PlaceSearchAgentQuestion(result.question);
  if (result.status === 'failed') {
    throw new ServiceUnavailableException({
      code: 'PLACE_SEARCH_AGENT_FAILED',
      reason: result.code,
      message: 'The place search agent could not complete a verified search',
    });
  }
  const completed: PlaceProvider = {
    mode: provider.mode,
    name: 'place-search-agent',
    search: () =>
      Promise.resolve({
        provider: 'place-search-agent',
        providerMode: provider.mode,
        query: request.query,
        places: result.places,
      }),
  };
  return searchPlaceWithDiagnostics(completed, request, request.role ?? 'candidate');
}
