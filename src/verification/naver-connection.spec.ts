import { verifyNaverConnection } from './naver-connection';

describe('NAVER API HUB connection verifier', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails clearly before making a request when credentials are missing', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(verifyNaverConnection({})).rejects.toThrow('NAVER_CLIENT_ID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports only a safe connection summary', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              title: '<b>테스트 카페</b>',
              address: '서울특별시 성동구 성수동',
              roadAddress: '서울특별시 성동구 서울숲길 1',
              mapx: '1270436000',
              mapy: '375467000',
            },
          ],
        }),
    } as Response);

    await expect(
      verifyNaverConnection({ NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' }),
    ).resolves.toEqual({
      provider: 'naver-api-hub',
      endpoint: 'https://naverapihub.apigw.ntruss.com/search/v1/local',
      authenticated: true,
      query: '성수 카페',
      resultCount: 1,
      resultsWithCoordinates: 1,
    });
  });
});
