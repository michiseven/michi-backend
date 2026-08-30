import { verifyKakaoConnection } from './kakao-connection';

describe('Kakao Local API connection verifier', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails before a request when the REST API key is missing', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(verifyKakaoConnection({})).rejects.toThrow('KAKAO_REST_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a safe summary without exposing the credential', async () => {
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

    await expect(verifyKakaoConnection({ KAKAO_REST_API_KEY: 'secret' })).resolves.toEqual({
      provider: 'kakao-local',
      endpoint: 'https://dapi.kakao.com/v2/local/search/keyword.json',
      authenticated: true,
      query: '공덕 카페',
      resultCount: 1,
      resultsWithCoordinates: 1,
      stableProviderIds: 1,
    });
  });
});
