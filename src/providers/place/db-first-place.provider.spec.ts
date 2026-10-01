import { DbFirstPlaceProvider } from './db-first-place.provider';
import { PlaceNormalizer } from './place-normalizer';
import type { Place } from '../../database/entities';

describe('DB first itinerary search', () => {
  it('does not secretly retry a search owned by the agent loop', async () => {
    const { provider, search } = setup([]);
    await provider.search({ area: '홍대', role: 'cafe', query: '찻집', singleAttempt: true });
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('excludes study cafes returned by NAVER while retaining ordinary cafes', async () => {
    const { provider, search } = setup([]);
    search.mockResolvedValue({
      places: ['홍대 스터디카페', '홍대 커피'].map((name, index) => ({
        provider: 'naver-local',
        providerMode: 'live',
        sourcePlaceId: String(index),
        sourcePlaceIdKind: 'provider',
        name,
        rawCategory: '음식점>카페',
        address: '서울 마포구',
        roadAddress: null,
        longitude: 126.925,
        latitude: 37.555,
        rawPayload: {},
      })),
    });
    const result = await provider.search({ area: '홍대', role: 'cafe', query: '카페' });
    expect(result.places.map((item) => item.name)).toEqual(['홍대 커피']);
  });
  it('excludes stale DB study cafes while retaining ordinary cafes', async () => {
    const study = {
      ...place('study'),
      name: '홍대 스터디카페',
      rawCategory: '서비스>스터디카페',
    } as Place;
    const { provider, search } = setup([study, ...['a', 'b', 'c'].map((id) => place(id))]);
    const result = await provider.search({ area: '홍대', role: 'cafe', query: '카페' });
    expect(result.places.map((item) => item.sourcePlaceId)).toEqual(['a', 'b', 'c']);
    expect(search).not.toHaveBeenCalled();
  });
  const place = (id: string, category = 'cafe'): Place =>
    ({
      id,
      source: 'naver-local',
      sourcePlaceId: id,
      name: `홍대 카페 ${id}`,
      category,
      rawCategory: category === 'cafe' ? '카페' : '공원',
      address: '서울 마포구',
      roadAddress: null,
      location: { type: 'Point', coordinates: [126.925, 37.555] },
      rawPayload: {},
    }) as Place;

  function setup(stored: Place[]): {
    provider: DbFirstPlaceProvider;
    search: jest.Mock;
    searchStoredCandidates: jest.Mock;
  } {
    const searchStoredCandidates = jest.fn().mockResolvedValue(stored);
    const filterPlaces = jest.fn().mockImplementation((_area: string, places: Place[]) =>
      Promise.resolve({
        applied: true,
        places: places.filter((p) => p.sourcePlaceId !== 'outside'),
      }),
    );
    const search = jest.fn().mockResolvedValue({ places: [] });
    const provider = new DbFirstPlaceProvider(
      { searchStoredCandidates } as never,
      { filterCandidateCoordinates: filterPlaces } as never,
      { search } as never,
      new PlaceNormalizer(),
    );
    return { provider, search, searchStoredCandidates };
  }

  it('skips NAVER only when enough matching DB candidates exist', async () => {
    const { provider, search } = setup(['a', 'b', 'c'].map((id) => place(id)));
    const result = await provider.search({ area: '홍대', role: 'cafe', query: '카페' });
    expect(result.places).toHaveLength(3);
    expect(search).not.toHaveBeenCalled();
  });

  it('searches NAVER after DB when the requested role is missing', async () => {
    const { provider, search, searchStoredCandidates } = setup(
      ['a', 'b', 'c'].map((id) => place(id)),
    );
    await provider.search({ area: '홍대', role: 'park', query: '공원' });
    expect(search).toHaveBeenCalledWith({ area: '홍대', role: 'park', query: '공원' });
    expect(searchStoredCandidates.mock.invocationCallOrder[0]).toBeLessThan(
      search.mock.invocationCallOrder[0]!,
    );
  });

  it('uses verified raw category evidence for cached places whose derived category is stale', async () => {
    const historicHanok = {
      ...place('hanok', '관광,명소'),
      name: '서촌한옥마을',
      rawCategory: '여행 > 관광,명소',
    };
    const { provider, search } = setup([historicHanok]);

    const result = await provider.search({ area: '서촌', role: 'attraction', query: '한옥' });

    expect(result.places).toHaveLength(1);
    expect(search).toHaveBeenCalled();
  });

  it('does not count outside-area or wrong-category records as eligible and merges valid results', async () => {
    const { provider, search } = setup([place('cached')]);
    search.mockResolvedValue({
      places: ['valid', 'outside', 'wrong'].map((id) => ({
        provider: 'naver-local',
        providerMode: 'live',
        sourcePlaceId: id,
        sourcePlaceIdKind: 'provider',
        name: `카페 ${id}`,
        rawCategory: id === 'wrong' ? '공원' : '카페',
        address: '서울 마포구',
        roadAddress: null,
        longitude: 126.925,
        latitude: 37.555,
        rawPayload: {},
      })),
    });
    const result = await provider.search({ area: '홍대', role: 'cafe', query: '카페' });
    expect(result.places.map((p) => p.sourcePlaceId)).toEqual(['cached', 'valid']);
  });

  it('does not hide a NAVER failure as empty successful search', async () => {
    const { provider, search } = setup([]);
    search.mockRejectedValue(new Error('NAVER unavailable'));
    await expect(provider.search({ area: '홍대', role: 'park', query: '공원' })).rejects.toThrow(
      'NAVER unavailable',
    );
  });

  it('retries an empty dietary query without dropping the dietary term or mutating cache', async () => {
    const { provider, search } = setup([]);
    const cached = { places: [] };
    search.mockResolvedValue(cached);
    await provider.search({ area: '이태원', role: 'restaurant', query: '비건 맛집' });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenNthCalledWith(1, {
      area: '이태원',
      role: 'restaurant',
      query: '비건 맛집',
    });
    expect(search).toHaveBeenNthCalledWith(2, {
      area: '이태원',
      role: 'restaurant',
      query: '비건',
    });
    expect(cached.places).toEqual([]);
  });

  it('retries when a nonempty NAVER response is eliminated by the verified role gate', async () => {
    const { provider, search } = setup([]);
    search
      .mockResolvedValueOnce({
        places: [
          {
            provider: 'naver-local',
            providerMode: 'live',
            sourcePlaceId: 'park',
            sourcePlaceIdKind: 'provider',
            name: '이태원 공원',
            rawCategory: '공원',
            address: '서울 용산구',
            roadAddress: null,
            longitude: 126.99,
            latitude: 37.53,
            rawPayload: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        places: [
          {
            provider: 'naver-local',
            providerMode: 'live',
            sourcePlaceId: 'vegan',
            sourcePlaceIdKind: 'provider',
            name: '이태원 비건 식당',
            rawCategory: '음식점',
            address: '서울 용산구',
            roadAddress: null,
            longitude: 126.99,
            latitude: 37.53,
            rawPayload: {},
          },
        ],
      });
    const result = await provider.search({
      area: '이태원',
      role: 'restaurant',
      query: '비건 맛집',
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith({ area: '이태원', role: 'restaurant', query: '비건' });
    expect(result.places.map((candidate) => candidate.sourcePlaceId)).toEqual(['vegan']);
  });
});
