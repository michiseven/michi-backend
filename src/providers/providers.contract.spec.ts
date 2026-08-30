import { ConfigService } from '@nestjs/config';
import { TtlCache } from '../common/cache/ttl-cache';
import { MockCrowdProvider } from './crowd/mock-crowd.provider';
import { SeoulCrowdProvider } from './crowd/seoul-crowd.provider';
import { MockPlaceProvider } from './place/mock-place.provider';
import { KakaoPlaceProvider } from './place/kakao-place.provider';
import { NaverPlaceProvider } from './place/naver-place.provider';
import type { PlaceProvider, PlaceSearchResponse } from './place/place-provider';

function assertPlaceResponseContract(response: PlaceSearchResponse): void {
  expect(['mock', 'live']).toContain(response.providerMode);
  expect(typeof response.provider).toBe('string');
  expect(typeof response.query).toBe('string');
  for (const place of response.places) {
    expect(typeof place.provider).toBe('string');
    expect(place.providerMode).toBe(response.providerMode);
    expect(typeof place.sourcePlaceId).toBe('string');
    expect(typeof place.name).toBe('string');
    expect(typeof place.rawPayload).toBe('object');
  }
}

describe('provider interface contracts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps mock and NAVER adapters on the same PlaceProvider contract', async () => {
    const mock: PlaceProvider = new MockPlaceProvider();
    const mockResponse = await mock.search({ area: '성수', query: '카페', limit: 5 });

    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              title: '테스트 장소',
              link: 'naver-place-id',
              category: '카페,디저트>카페',
              address: '서울특별시 성동구 성수동1가',
              roadAddress: '서울특별시 성동구 서울숲길 1',
              mapx: '1270436000',
              mapy: '375467000',
            },
          ],
        }),
    } as Response);
    const live: PlaceProvider = new NaverPlaceProvider(
      new ConfigService({
        NAVER_LOCAL_SEARCH_URL: 'https://naverapihub.apigw.ntruss.com/search/v1/local',
        NAVER_CLIENT_ID: 'test-id',
        NAVER_CLIENT_SECRET: 'test-secret',
        PROVIDER_CACHE_TTL_SECONDS: 300,
      }),
      new TtlCache(),
    );
    const liveResponse = await live.search({ area: '성수', query: '카페', limit: 5 });

    assertPlaceResponseContract(mockResponse);
    assertPlaceResponseContract(liveResponse);
    expect(mockResponse.places[0]?.rawPayload).toMatchObject({ synthetic: true });
    expect(liveResponse.places[0]?.rawPayload).not.toHaveProperty('synthetic');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'https://naverapihub.apigw.ntruss.com',
        pathname: '/search/v1/local',
      }),
      expect.objectContaining({
        headers: {
          'X-NCP-APIGW-API-KEY-ID': 'test-id',
          'X-NCP-APIGW-API-KEY': 'test-secret',
        },
      }),
    );
  });

  it('keeps Kakao on the shared PlaceProvider contract', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          documents: [
            {
              id: '922091993',
              place_name: '비파티세리 공덕점',
              category_name: '음식점 > 카페',
              address_name: '서울 마포구 공덕동',
              road_address_name: '서울 마포구 마포대로14길 4',
              x: '126.95511954274626',
              y: '37.548617458134956',
            },
          ],
        }),
    } as Response);
    const provider: PlaceProvider = new KakaoPlaceProvider(
      new ConfigService({
        KAKAO_REST_API_KEY: 'test-key',
        KAKAO_LOCAL_SEARCH_URL: 'https://dapi.kakao.com/v2/local/search/keyword.json',
        PROVIDER_CACHE_TTL_SECONDS: 300,
      }),
      new TtlCache(),
    );

    const response = await provider.search({ area: '공덕', query: '카페', limit: 15 });

    assertPlaceResponseContract(response);
    expect(response.provider).toBe('kakao-local');
    expect(response.places[0]).toMatchObject({
      sourcePlaceId: '922091993',
      sourcePlaceIdKind: 'provider',
    });
  });

  it('keeps mock and Seoul adapters on the same area-scoped crowd contract', async () => {
    const mock = await new MockCrowdProvider().getAreaCrowd('성수역');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          SeoulRtd: {
            RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다' },
            citydata_ppltn: [
              {
                AREA_NM: '성수카페거리',
                AREA_CD: 'POI001',
                LIVE_PPLTN_STTS: [
                  {
                    AREA_CONGEST_LVL: '보통',
                    AREA_CONGEST_MSG: '지역 단위 메시지',
                    PPLTN_TIME: '2026-08-18 12:00',
                  },
                ],
              },
            ],
          },
        }),
    } as Response);
    const live = await new SeoulCrowdProvider(
      new ConfigService({
        SEOUL_OPEN_DATA_BASE_URL: 'http://openapi.seoul.go.kr:8088',
        SEOUL_OPEN_DATA_API_KEY: 'test-key',
        PROVIDER_CACHE_TTL_SECONDS: 300,
      }),
      new TtlCache(),
    ).getAreaCrowd('성수');
    expect(live).not.toBeNull();
    if (!live) throw new Error('Expected a live crowd observation');

    for (const response of [mock, live]) {
      expect(response.scope).toBe('area');
      expect(response.disclaimer).toContain('특정 장소 내부');
      expect(['mock', 'live']).toContain(response.providerMode);
      expect(response.rawPayload).toEqual(expect.any(Object));
    }
    expect(live.sourceUrl).not.toContain('test-key');
    expect(live.sourceUrl).toContain('data.seoul.go.kr/dataList/');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('성수카페거리')),
      expect.any(Object),
    );
  });

  it('returns no observation instead of failing when Seoul does not cover an area', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          'RESULT.CODE': 'ERROR-500',
          'RESULT.MESSAGE': '지원하지 않는 지역',
        }),
    } as Response);
    const provider = new SeoulCrowdProvider(
      new ConfigService({
        SEOUL_OPEN_DATA_BASE_URL: 'http://openapi.seoul.go.kr:8088',
        SEOUL_OPEN_DATA_API_KEY: 'test-key',
        PROVIDER_CACHE_TTL_SECONDS: 300,
      }),
      new TtlCache(),
    );

    await expect(provider.getAreaCrowd('공덕')).resolves.toBeNull();
  });
});
