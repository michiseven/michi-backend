import { verifyKtoConnection } from './kto-connection';

describe('KTO TourAPI connection verifier', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails clearly before making a request when the service key is missing', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(verifyKtoConnection({})).rejects.toThrow('KTO_TOUR_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports only a safe Seoul page summary', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          response: {
            header: { resultCode: '0000', resultMsg: 'OK' },
            body: {
              pageNo: 1,
              numOfRows: 20,
              totalCount: 1,
              items: {
                item: {
                  contentid: '1',
                  contenttypeid: '76',
                  title: 'ソウル観光地',
                  addr1: 'ソウル特別市',
                  mapx: '127.0',
                  mapy: '37.5',
                  areacode: '1',
                },
              },
            },
          },
        }),
    } as Response);

    await expect(verifyKtoConnection({ KTO_TOUR_API_KEY: 'encoded%2Bkey' })).resolves.toEqual({
      provider: 'kto-tour-jpn',
      endpoint: 'https://apis.data.go.kr/B551011/JpnService2/areaBasedList2',
      authenticated: true,
      seoulTotalCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      resultsWithCoordinates: 1,
      resultsWithJapaneseText: 1,
    });
  });
});
