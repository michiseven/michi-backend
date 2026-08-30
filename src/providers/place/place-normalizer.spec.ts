import { PlaceNormalizer, normalizeNaverLocalItem } from './place-normalizer';

describe('NAVER place normalization', () => {
  it('converts official WGS84 integer coordinates and preserves raw data', () => {
    const raw = {
      title: '<b>서울시청</b>',
      link: 'https://example.invalid/provider-place-id',
      category: '공공,사회기관>시청',
      address: '서울특별시 중구 태평로1가',
      roadAddress: '서울특별시 중구 세종대로 110',
      mapx: '1269873882',
      mapy: '375666103',
      providerOnlyField: 'kept',
    };

    const providerRecord = normalizeNaverLocalItem(raw);
    expect(providerRecord).not.toBeNull();
    expect(providerRecord).toMatchObject({
      name: '서울시청',
      longitude: 126.9873882,
      latitude: 37.5666103,
      sourcePlaceIdKind: 'derived',
      rawPayload: raw,
    });
    expect(providerRecord!.sourcePlaceId).toMatch(/^derived:[a-f0-9]{64}$/);

    const normalized = new PlaceNormalizer().normalize(providerRecord!);
    expect(normalized.location).toEqual({
      type: 'Point',
      coordinates: [126.9873882, 37.5666103],
    });
    expect(normalized.district).toBe('중구');
    expect(normalized.rawPayload.sourceRecord).toMatchObject({ providerOnlyField: 'kept' });
  });

  it('separates franchise branches sharing the same homepage URL into distinct sourcePlaceIds', () => {
    const starbucksMapo = {
      title: '<b>스타벅스</b> 마포염리점',
      link: 'http://www.starbucks.co.kr/',
      category: '음식점>카페>커피전문점>스타벅스',
      address: '서울특별시 마포구 염리동 173-29',
      roadAddress: '서울특별시 마포구 마포대로 130',
      mapx: '1269480000',
      mapy: '375450000',
    };
    const starbucksPress = {
      title: '<b>스타벅스</b> 한국프레스센터점',
      link: 'http://www.starbucks.co.kr/',
      category: '음식점>카페>커피전문점>스타벅스',
      address: '서울특별시 중구 태평로1가 25',
      roadAddress: '서울특별시 중구 세종대로 124',
      mapx: '1269770000',
      mapy: '375670000',
    };

    const recordMapo = normalizeNaverLocalItem(starbucksMapo);
    const recordPress = normalizeNaverLocalItem(starbucksPress);

    expect(recordMapo).not.toBeNull();
    expect(recordPress).not.toBeNull();
    expect(recordMapo!.sourcePlaceId).not.toEqual(recordPress!.sourcePlaceId);
    expect(recordMapo!.name).toBe('스타벅스 마포염리점');
    expect(recordPress!.name).toBe('스타벅스 한국프레스센터점');
  });

  it('rejects records that cannot be verified as Seoul places', () => {
    expect(
      normalizeNaverLocalItem({
        title: '부산 장소',
        address: '부산광역시 중구',
        mapx: '1290000000',
        mapy: '350000000',
      }),
    ).toBeNull();
  });

  it('keeps missing coordinates null instead of inventing them', () => {
    const record = normalizeNaverLocalItem({ title: '장소', address: '서울특별시 성동구' });
    expect(record).toMatchObject({ longitude: null, latitude: null });
    expect(new PlaceNormalizer().normalize(record!).location).toBeNull();
  });

  it.each([
    ['한식>냉면', 'restaurant'],
    ['한식>곱창,막창,양', 'restaurant'],
    ['음식점>카페>커피전문점', 'cafe'],
  ])('normalizes the complete NAVER category hierarchy %s as %s', (category, expected) => {
    const record = normalizeNaverLocalItem({
      title: '공덕 테스트 장소',
      category,
      address: '서울특별시 마포구 공덕동',
      mapx: '1269490000',
      mapy: '375420000',
    });

    expect(new PlaceNormalizer().normalize(record!).category).toBe(expected);
  });

  it('normalizes KTO medical tourism code A02020500 and clinical categories as medical', () => {
    const normalizer = new PlaceNormalizer();
    const ktoClinic = normalizer.normalize({
      provider: 'kto-tour-jpn',
      providerMode: 'live',
      sourcePlaceId: '12345',
      sourcePlaceIdKind: 'provider',
      name: 'ホンデid美容クリニック',
      rawCategory: 'kto:76:A02:A0202:A02020500',
      address: '서울특별시 마포구 양화로 100',
      roadAddress: null,
      longitude: 126.92,
      latitude: 37.55,
      rawPayload: {},
    });
    expect(ktoClinic.category).toBe('medical');

    const naverClinic = normalizer.normalize({
      provider: 'naver-local',
      providerMode: 'live',
      sourcePlaceId: 'derived:abc',
      sourcePlaceIdKind: 'derived',
      name: '닥터포헤어 피부과의원',
      rawCategory: '병원,의원>피부과',
      address: '서울특별시 마포구 홍익로 10',
      roadAddress: null,
      longitude: 126.92,
      latitude: 37.55,
      rawPayload: {},
    });
    expect(naverClinic.category).toBe('medical');
  });
});
