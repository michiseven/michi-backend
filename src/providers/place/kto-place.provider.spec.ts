import { ConfigService } from '@nestjs/config';
import { KtoPlaceProvider, normalizeKtoTourItem } from './kto-place.provider';
import { PlaceNormalizer } from './place-normalizer';

describe('KtoPlaceProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('normalizes only Seoul records with provider coordinates', () => {
    expect(
      normalizeKtoTourItem({
        contentid: '2645880',
        contenttypeid: '82',
        title: 'ソンスヨンバン',
        addr1: 'ソウル特別市 城東区',
        mapx: '127.0441',
        mapy: '37.5445',
        areacode: '1',
        cat1: 'A04',
      }),
    ).toMatchObject({
      provider: 'kto-tour-jpn',
      sourcePlaceId: '2645880',
      name: 'ソンスヨンバン',
      rawCategory: 'kto:82:A04',
      longitude: 127.0441,
      latitude: 37.5445,
    });
    expect(
      normalizeKtoTourItem({
        contentid: 'outside',
        title: '부산 장소',
        mapx: '129.0',
        mapy: '35.0',
        areacode: '6',
      }),
    ).toBeNull();
  });

  it('calls areaBasedList2 with Seoul area code and parses an object item', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          response: {
            header: { resultCode: '0000', resultMsg: 'OK' },
            body: {
              pageNo: 1,
              numOfRows: 100,
              totalCount: 1,
              items: {
                item: {
                  contentid: '1',
                  contenttypeid: '85',
                  title: 'レストラン',
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
    const provider = new KtoPlaceProvider(
      new ConfigService({
        KTO_PROVIDER_MODE: 'live',
        KTO_TOUR_API_KEY: 'encoded%2Bkey',
        KTO_TOUR_API_BASE_URL: 'https://apis.data.go.kr/B551011/JpnService2',
        KTO_MOBILE_APP: 'Michi',
      }),
    );

    const page = await provider.fetchSeoulPage(1, 100);

    expect(page).toMatchObject({ totalCount: 1, rejectedCount: 0 });
    expect(page.places).toHaveLength(1);
    expect(new PlaceNormalizer().normalize(page.places[0]!).category).toBe('restaurant');
    const requested = fetchMock.mock.calls[0]?.[0];
    if (!(requested instanceof URL)) throw new Error('Expected KTO request URL');
    expect(requested.pathname.endsWith('/areaBasedList2')).toBe(true);
    expect(requested.searchParams.get('areaCode')).toBe('1');
    expect(requested.searchParams.get('serviceKey')).toBe('encoded+key');
  });
});
