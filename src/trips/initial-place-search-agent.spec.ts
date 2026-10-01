import {
  PlaceSearchAgentQuestion,
  searchInitialPlaceWithAgent,
} from './initial-place-search-agent';
import type { PlaceProvider } from '../providers/place/place-provider';

describe('initial itinerary place search agent integration', () => {
  const existingSearch = jest.fn();
  const provider = {
    mode: 'live',
    name: 'existing',
    search: existingSearch,
  } as unknown as PlaceProvider;
  it('feeds completed provider records to existing search diagnostics without running a second search', async () => {
    const record = { provider: 'naver-local', sourcePlaceId: '1' };
    const searchVerified = jest
      .fn()
      .mockResolvedValue({ status: 'completed', places: [record], observations: [] });
    const result = await searchInitialPlaceWithAgent(
      provider,
      { area: '공덕', query: '카페', role: 'cafe' },
      { searchVerified },
      'ja',
    );
    expect(result.records).toEqual([record]);
    expect(result.status).toBe('ok');
    expect(searchVerified).toHaveBeenCalledWith(
      { area: '공덕', query: '카페', role: 'cafe' },
      'ja',
    );
    expect(existingSearch).not.toHaveBeenCalled();
  });
  it('surfaces a model question instead of treating it as empty results or continuing generation', async () => {
    const searchVerified = jest.fn().mockResolvedValue({
      status: 'clarify',
      question: '어떤 종류의 카페를 원하세요?',
      observations: [],
    });
    await expect(
      searchInitialPlaceWithAgent(
        provider,
        { area: '공덕', query: '카페' },
        { searchVerified },
        'ko',
      ),
    ).rejects.toBeInstanceOf(PlaceSearchAgentQuestion);
  });
  it('fails closed on exhausted calls instead of falling back to a fixed search sequence', async () => {
    const searchVerified = jest
      .fn()
      .mockResolvedValue({ status: 'failed', code: 'CALL_LIMIT', observations: [] });
    await expect(
      searchInitialPlaceWithAgent(
        provider,
        { area: '공덕', query: '카페' },
        { searchVerified },
        'ko',
      ),
    ).rejects.toThrow();
    expect(existingSearch).not.toHaveBeenCalled();
  });
});
