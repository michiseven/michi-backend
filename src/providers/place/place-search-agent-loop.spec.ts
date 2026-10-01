import { runPlaceSearchAgent, type PlaceSearchAgentAction } from './place-search-agent-loop';
import type { ProviderPlaceRecord, PlaceSearchRequest } from './place-provider';

const request = { area: '공덕', role: 'cafe', query: '찻집', limit: 20 };
const record: ProviderPlaceRecord = {
  provider: 'naver-local',
  providerMode: 'live',
  sourcePlaceId: '123',
  sourcePlaceIdKind: 'provider',
  name: '검증된 장소',
  rawCategory: '카페',
  address: '서울',
  roadAddress: null,
  longitude: 126.95,
  latitude: 37.54,
  rawPayload: {},
};
const signal = (): AbortSignal => new AbortController().signal;
type Decider = Parameters<typeof runPlaceSearchAgent>[1];
const scripted = (
  ...actions: PlaceSearchAgentAction[]
): jest.Mock<ReturnType<Decider>, Parameters<Decider>> =>
  jest
    .fn<ReturnType<Decider>, Parameters<Decider>>()
    .mockImplementation(() => Promise.resolve(actions.shift()!));

describe('bounded place search agent loop', () => {
  it('stops waiting for a stalled model when cancelled and executes no search', async () => {
    const controller = new AbortController();
    const decide = jest.fn((): Promise<PlaceSearchAgentAction> => new Promise(() => undefined));
    const search = jest.fn();
    const running = runPlaceSearchAgent(request, decide, search, controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(running).rejects.toThrow('cancelled');
    expect(search).not.toHaveBeenCalled();
  });
  it('returns empty search observations to the model before it chooses a second search and finishes', async () => {
    const decide = scripted(
      { action: 'search', query: '찻집' },
      { action: 'search', query: '전통차' },
      { action: 'finish', placeKeys: ['naver-local:123'] },
    );
    const search = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([record]);
    const result = await runPlaceSearchAgent(request, decide, search, signal());
    expect(result.status).toBe('completed');
    expect(decide.mock.calls[1]?.[0].observations[0]?.status).toBe('empty');
    expect(decide.mock.calls[2]?.[0].observations[1]?.places[0]?.key).toBe('naver-local:123');
    expect(
      (search.mock.calls as [PlaceSearchRequest, AbortSignal][]).map((call) => call[0]),
    ).toEqual([
      { ...request, query: '찻집', limit: 10 },
      { ...request, query: '전통차', limit: 10 },
    ]);
  });
  it('lets the model ask rather than inventing candidates after no results', async () => {
    const result = await runPlaceSearchAgent(
      request,
      scripted(
        { action: 'search', query: '찻집' },
        { action: 'ask', question: '방문할 지역을 다시 확인해 주세요.' },
      ),
      jest.fn().mockResolvedValue([]),
      signal(),
    );
    expect(result).toMatchObject({
      status: 'clarify',
      question: '방문할 지역을 다시 확인해 주세요.',
    });
  });
  it('rejects invented IDs, including before any search', async () => {
    expect(
      await runPlaceSearchAgent(
        request,
        scripted({ action: 'finish', placeKeys: ['invented'] }),
        jest.fn(),
        signal(),
      ),
    ).toMatchObject({ status: 'failed', code: 'NO_VERIFIED_RESULTS' });
  });
  it('bounds both actual searches and repeated decisions', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const result = await runPlaceSearchAgent(
      request,
      scripted(...['a', 'b', 'c', 'd'].map((query) => ({ action: 'search' as const, query }))),
      search,
      signal(),
    );
    expect(result).toMatchObject({ status: 'failed', code: 'CALL_LIMIT' });
    expect(search).toHaveBeenCalledTimes(3);
    const repeated = jest.fn().mockResolvedValue({ action: 'search', query: 'same' });
    const sameSearch = jest.fn().mockResolvedValue([]);
    expect(await runPlaceSearchAgent(request, repeated, sameSearch, signal())).toMatchObject({
      status: 'failed',
      code: 'CALL_LIMIT',
    });
    expect(repeated).toHaveBeenCalledTimes(6);
    expect(sameSearch).toHaveBeenCalledTimes(1);
  });
  it('reports provider failure without leaking raw secrets and still permits a question', async () => {
    const decide = scripted(
      { action: 'search', query: '찻집' },
      { action: 'ask', question: '다른 검색어를 알려 주세요.' },
    );
    const result = await runPlaceSearchAgent(
      request,
      decide,
      jest.fn().mockRejectedValue(new Error('secret-token')),
      signal(),
    );
    expect(result.status).toBe('clarify');
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(decide.mock.calls[1]?.[0].observations[0]?.status).toBe('provider_error');
  });
  it('does not start another model or search call after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const decide = jest.fn();
    await expect(
      runPlaceSearchAgent(request, decide, jest.fn(), controller.signal),
    ).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
  });
});
