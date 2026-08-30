import { verifySeoulConnection } from './seoul-connection';

describe('Seoul Open Data connection verifier', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails clearly before making a request when the API key is missing', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(verifySeoulConnection({})).rejects.toThrow('SEOUL_OPEN_DATA_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an area-scoped summary without exposing the API key', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          RESULT: {
            'RESULT.CODE': 'INFO-000',
            'RESULT.MESSAGE': '정상 처리되었습니다',
          },
          'SeoulRtd.citydata_ppltn': [
            {
              AREA_NM: '성수카페거리',
              AREA_CD: 'POI001',
              AREA_CONGEST_LVL: '보통',
              AREA_CONGEST_MSG: '지역 단위 메시지',
              PPLTN_TIME: '2026-08-21 12:00',
            },
          ],
        }),
    } as Response);

    const summary = await verifySeoulConnection({ SEOUL_OPEN_DATA_API_KEY: 'private-key' });

    expect(summary).toEqual({
      provider: 'seoul-open-data',
      endpoint: 'http://openapi.seoul.go.kr:8088/{KEY}/json/citydata_ppltn/1/5/{AREA_NAME}',
      authenticated: true,
      scope: 'area',
      areaName: '성수카페거리',
      areaCode: 'POI001',
      congestionLevel: '보통',
      observedAt: '2026-08-21 12:00',
      hasCongestionMessage: true,
    });
    expect(JSON.stringify(summary)).not.toContain('private-key');
  });
});
