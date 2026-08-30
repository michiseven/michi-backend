import { ConfigService } from '@nestjs/config';
import { TtlCache } from '../../common/cache/ttl-cache';
import { KakaoPlaceProvider, normalizeKakaoLocalDocument } from './kakao-place.provider';

describe('KakaoPlaceProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes a verified Kakao place identity and WGS84 coordinates', () => {
    expect(
      normalizeKakaoLocalDocument({
        id: '922091993',
        place_name: '비파티세리 공덕점',
        category_name: '음식점 > 카페',
        address_name: '서울 마포구 공덕동 105-200',
        road_address_name: '서울 마포구 마포대로14길 4',
        x: '126.95511954274626',
        y: '37.548617458134956',
        place_url: 'https://place.map.kakao.com/922091993',
      }),
    ).toMatchObject({
      provider: 'kakao-local',
      sourcePlaceId: '922091993',
      sourcePlaceIdKind: 'provider',
      name: '비파티세리 공덕점',
      longitude: 126.95511954274626,
      latitude: 37.548617458134956,
    });
  });

  it('rejects non-Seoul results without guessing the location', () => {
    expect(
      normalizeKakaoLocalDocument({
        id: '1',
        place_name: '부산 카페',
        address_name: '부산 해운대구 우동',
      }),
    ).toBeNull();
  });

  it('uses REST API authentication and requests up to 15 results', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          documents: [
            {
              id: '1',
              place_name: '공덕 카페',
              category_name: '음식점 > 카페',
              address_name: '서울 마포구 공덕동',
              road_address_name: '서울 마포구 마포대로 1',
              x: '126.95',
              y: '37.54',
            },
          ],
        }),
    } as Response);
    const provider = new KakaoPlaceProvider(
      new ConfigService({
        KAKAO_REST_API_KEY: 'test-key',
        KAKAO_LOCAL_SEARCH_URL: 'https://dapi.kakao.com/v2/local/search/keyword.json',
        PROVIDER_CACHE_TTL_SECONDS: 300,
      }),
      new TtlCache(),
    );

    const response = await provider.search({ area: '공덕', query: '카페', limit: 20 });

    expect(response.places).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'https://dapi.kakao.com',
        pathname: '/v2/local/search/keyword.json',
      }),
      expect.objectContaining({ headers: { Authorization: 'KakaoAK test-key' } }),
    );
    const requestUrl = fetchMock.mock.calls[0]?.[0];
    expect(requestUrl).toBeInstanceOf(URL);
    expect((requestUrl as URL).searchParams.get('size')).toBe('15');
  });
});
