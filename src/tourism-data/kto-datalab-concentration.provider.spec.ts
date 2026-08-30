import { ConfigService } from '@nestjs/config';
import {
  KtoDataLabConcentrationProvider,
  normalizeKtoConcentrationItem,
  SEOUL_DATALAB_DISTRICTS,
} from './kto-datalab-concentration.provider';

const jongno = SEOUL_DATALAB_DISTRICTS[0];

describe('KtoDataLabConcentrationProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('normalizes the official concentration response without changing its 0-100 scale', () => {
    expect(
      normalizeKtoConcentrationItem(
        {
          areaCd: '11',
          areaNm: '서울특별시',
          signguCd: '11110',
          signguNm: '종로구',
          tAtsNm: '광화문',
          baseYmd: '20260821',
          cnctrRate: '72.95',
        },
        jongno,
      ),
    ).toEqual({
      areaCode: '11',
      areaName: '서울특별시',
      districtCode: '11110',
      districtName: '종로구',
      attractionName: '광화문',
      forecastDate: '2026-08-21',
      concentrationIndex: 72.95,
    });
  });

  it('rejects a mismatched district, invalid date, or out-of-range index', () => {
    const base = {
      areaCd: '11',
      areaNm: '서울특별시',
      signguCd: '11110',
      signguNm: '종로구',
      tAtsNm: '광화문',
      baseYmd: '20260821',
      cnctrRate: '72.95',
    };
    expect(normalizeKtoConcentrationItem({ ...base, signguCd: '11140' }, jongno)).toBeNull();
    expect(normalizeKtoConcentrationItem({ ...base, baseYmd: '20260230' }, jongno)).toBeNull();
    expect(normalizeKtoConcentrationItem({ ...base, cnctrRate: '101' }, jongno)).toBeNull();
  });

  it('fetches and validates an authenticated district page', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          response: {
            header: { resultCode: '0000', resultMsg: 'OK' },
            body: {
              totalCount: 1,
              pageNo: 1,
              numOfRows: 10,
              items: {
                item: {
                  areaCd: '11',
                  areaNm: '서울특별시',
                  signguCd: '11110',
                  signguNm: '종로구',
                  tAtsNm: '광화문',
                  baseYmd: '20260821',
                  cnctrRate: '72.95',
                },
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const provider = new KtoDataLabConcentrationProvider(
      new ConfigService({
        KTO_DATALAB_PROVIDER_MODE: 'live',
        KTO_DATALAB_API_KEY: 'encoded%2Bkey',
        KTO_DATALAB_CONCENTRATION_URL:
          'https://apis.data.go.kr/B551011/TatsCnctrRateService/tatsCnctrRatedList',
        KTO_MOBILE_APP: 'Michi',
      }),
    );

    await expect(provider.fetchDistrict(jongno, 10)).resolves.toMatchObject({
      totalAvailable: 1,
      pages: 1,
      rejectedCount: 0,
      records: [{ attractionName: '광화문', concentrationIndex: 72.95 }],
    });
    const requested = fetchMock.mock.calls[0]?.[0];
    if (!(requested instanceof URL)) throw new Error('Expected KTO DataLab request URL');
    expect(requested.searchParams.get('serviceKey')).toBe('encoded+key');
  });
});
