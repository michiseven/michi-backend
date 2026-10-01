import type OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { PlaceSearchAgentService } from './place-search-agent.service';
import type { PlaceProvider, ProviderPlaceRecord, PlaceSearchRequest } from './place-provider';

describe('PlaceSearchAgentService', () => {
  it('uses the existing search provider as a tool and returns only provider-owned public facts', async () => {
    const record: ProviderPlaceRecord = {
      provider: 'naver-local',
      providerMode: 'live',
      sourcePlaceId: '1',
      sourcePlaceIdKind: 'provider',
      name: '공덕 카페',
      rawCategory: '카페',
      address: '서울 마포구',
      roadAddress: null,
      longitude: 126.95,
      latitude: 37.54,
      rawPayload: { secret: 'do-not-expose' },
    };
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        output: [
          {
            type: 'function_call',
            name: 'search_places',
            call_id: 'a',
            arguments: '{"query":"카페"}',
          },
        ],
      })
      .mockResolvedValueOnce({
        output: [
          {
            type: 'function_call',
            name: 'finish_search',
            call_id: 'b',
            arguments: '{"placeKeys":["naver-local:1"]}',
          },
        ],
      });
    const search = jest.fn().mockResolvedValue({ places: [record] });
    const provider = { search } as unknown as PlaceProvider;
    const agent = new PlaceSearchAgentService(
      { responses: { create } } as unknown as OpenAI,
      new ConfigService({ OPENAI_MODEL: 'test-model' }),
      provider,
    );
    const result = await agent.search({ area: '공덕', role: 'cafe', query: '카페' });
    expect(result).toMatchObject({
      status: 'completed',
      routeValidation: 'not_performed',
      openingHoursVerification: 'unverified',
      places: [{ key: 'naver-local:1', name: '공덕 카페' }],
    });
    expect(JSON.stringify(result)).not.toContain('do-not-expose');
    expect((search.mock.calls[0] as [PlaceSearchRequest])[0]).toMatchObject({
      area: '공덕',
      role: 'cafe',
      singleAttempt: true,
    });
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('fails explicitly when no LLM is configured rather than disguising a fixed fallback as an agent', async () => {
    const search = jest.fn();
    const agent = new PlaceSearchAgentService(null, new ConfigService(), {
      search,
    } as unknown as PlaceProvider);
    await expect(agent.search({ area: '공덕', query: '카페' })).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
  });
});
