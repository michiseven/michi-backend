import { DbFirstPlaceProvider } from './db-first-place.provider';
import { PlaceNormalizer } from './place-normalizer';
import type { Place } from '../../database/entities';

describe('DB first itinerary search', () => {
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
});
