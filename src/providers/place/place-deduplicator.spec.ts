import type { Place } from '../../database/entities';
import { PlaceDeduplicator } from './place-deduplicator';

function makePlace(overrides: Partial<Place>): Place {
  return {
    id: 'default-id',
    source: 'naver-local',
    sourcePlaceId: 'default-source-id',
    name: '서울숲 카페',
    category: 'cafe',
    address: '서울특별시 성동구 서울숲길 1',
    roadAddress: '서울특별시 성동구 서울숲길 1',
    location: { type: 'Point', coordinates: [127.0437, 37.5467] },
    district: '성동구',
    rawCategory: '카페',
    rawPayload: { sourceRecord: {} },
    createdAt: new Date('2026-08-20T00:00:00Z'),
    updatedAt: new Date('2026-08-20T00:00:00Z'),
    tripStops: [],
    recommendationScores: [],
    ...overrides,
  };
}

describe('PlaceDeduplicator', () => {
  const deduplicator = new PlaceDeduplicator();

  it('1. merges duplicate places with the exact same source provider and sourcePlaceId', () => {
    const p1 = makePlace({
      id: 'kto-1',
      source: 'kto-tour-jpn',
      sourcePlaceId: 'kto-1001',
      name: '聖水洞カフェ（성수동 카페）',
    });
    const p2 = makePlace({
      id: 'kto-1-duplicate',
      source: 'kto-tour-jpn',
      sourcePlaceId: 'kto-1001',
      name: '聖水洞カフェ（성수동 카페）',
    });

    const result = deduplicator.deduplicate([p1, p2]);
    expect(result.removedCount).toBe(1);
    expect(result.places).toHaveLength(1);
    expect(result.reasonCounts.same_provider_identity).toBe(1);
    expect(result.matches[0]?.reason).toBe('same_provider_identity');
  });

  it('2. merges KTO and NAVER places with identical name within close proximity (<=150m)', () => {
    const kto = makePlace({
      id: 'kto-seongsu',
      source: 'kto-tour-jpn',
      sourcePlaceId: 'kto-2001',
      name: '성수연방',
      location: { type: 'Point', coordinates: [127.0559, 37.5427] },
    });
    const naver = makePlace({
      id: 'naver-seongsu',
      source: 'naver-local',
      sourcePlaceId: 'naver-2001',
      name: '성수연방',
      address: '서울특별시 성동구 연무장길 2',
      roadAddress: '서울특별시 성동구 연무장길 2',
      location: { type: 'Point', coordinates: [127.056, 37.5428] }, // ~15m
    });

    const result = deduplicator.deduplicate([naver, kto]);
    expect(result.removedCount).toBe(1);
    expect(result.places.map((p) => p.id)).toEqual(['kto-seongsu']);
    expect(result.reasonCounts.same_name_and_proximity).toBe(1);
  });

  it('3. merges KTO (Japanese name with Korean alias in parenthesis) and NAVER (Korean name) within close proximity', () => {
    const kto = makePlace({
      id: 'kto-cross-lang',
      source: 'kto-tour-jpn',
      sourcePlaceId: 'kto-3001',
      name: 'ソンスヨンバン（성수연방）',
      location: { type: 'Point', coordinates: [127.0559, 37.5427] },
    });
    const naver = makePlace({
      id: 'naver-korean-only',
      source: 'naver-local',
      sourcePlaceId: 'naver-3001',
      name: '성수연방',
      address: '서울특별시 성동구 연무장길 2',
      roadAddress: '서울특별시 성동구 연무장길 2',
      location: { type: 'Point', coordinates: [127.056, 37.54275] }, // ~12m
    });

    const result = deduplicator.deduplicate([naver, kto]);
    expect(result.removedCount).toBe(1);
    expect(result.places.map((p) => p.id)).toEqual(['kto-cross-lang']);
    expect(result.reasonCounts.same_korean_alias_and_proximity).toBe(1);
  });

  it('4. does NOT merge different businesses located in the same building / address', () => {
    const shopA = makePlace({
      id: 'shop-a',
      source: 'kto-tour-jpn',
      sourcePlaceId: 'kto-4001',
      name: '천상가옥',
      address: '서울특별시 성동구 성수이로14길 14',
      location: { type: 'Point', coordinates: [127.0559, 37.5427] },
    });
    const shopB = makePlace({
      id: 'shop-b',
      source: 'naver-local',
      sourcePlaceId: 'naver-4002',
      name: '띵굴스토어 성수점',
      address: '서울특별시 성동구 성수이로14길 14',
      location: { type: 'Point', coordinates: [127.0559, 37.5427] },
    });

    const result = deduplicator.deduplicate([shopA, shopB]);
    expect(result.removedCount).toBe(0);
    expect(result.places).toHaveLength(2);
    expect(result.places.map((p) => p.id)).toEqual(['shop-a', 'shop-b']);
  });

  it('records same address, name, and very close coordinates with the specific address reason', () => {
    const kto = makePlace({
      id: 'same-address-kto',
      source: 'kto-tour-jpn',
      sourcePlaceId: 'kto-address',
      name: '성수연방',
    });
    const naver = makePlace({
      id: 'same-address-naver',
      source: 'naver-local',
      sourcePlaceId: 'naver-address',
      name: '성수연방',
      location: { type: 'Point', coordinates: [127.04371, 37.54671] },
    });

    const result = deduplicator.deduplicate([naver, kto]);

    expect(result.removedCount).toBe(1);
    expect(result.reasonCounts.same_address_and_name_proximity).toBe(1);
  });

  it('uses Kakao phone metadata as conservative cross-provider duplicate evidence', () => {
    const kto = makePlace({
      id: 'kto-phone',
      source: 'kto-tour-jpn',
      sourcePlaceId: 'kto-phone-1',
      name: '日本語の観光地名',
      rawPayload: { sourceRecord: { tel: '02-1234-5678' } },
    });
    const kakao = makePlace({
      id: 'kakao-phone',
      source: 'kakao-local',
      sourcePlaceId: 'kakao-phone-1',
      name: '한국어 장소명',
      location: { type: 'Point', coordinates: [127.04371, 37.54671] },
      rawPayload: { sourceRecord: { phone: '02-1234-5678' } },
    });

    const result = deduplicator.deduplicate([kakao, kto]);

    expect(result.places.map((place) => place.id)).toEqual(['kto-phone']);
    expect(result.reasonCounts.same_phone_and_proximity).toBe(1);
  });

  it('5. does NOT merge chain stores with the exact same name located in distant areas (>150m)', () => {
    const starbucksGangnam = makePlace({
      id: 'sb-gangnam',
      source: 'naver-local',
      sourcePlaceId: 'sb-1',
      name: '스타벅스',
      location: { type: 'Point', coordinates: [127.0276, 37.4979] }, // Gangnam
    });
    const starbucksSeongsu = makePlace({
      id: 'sb-seongsu',
      source: 'naver-local',
      sourcePlaceId: 'sb-2',
      name: '스타벅스',
      location: { type: 'Point', coordinates: [127.0559, 37.5427] }, // Seongsu (>5km away)
    });

    const result = deduplicator.deduplicate([starbucksGangnam, starbucksSeongsu]);
    expect(result.removedCount).toBe(0);
    expect(result.places).toHaveLength(2);
  });

  it('6. does NOT merge places with missing/null coordinates based on name alone', () => {
    const p1 = makePlace({
      id: 'place-no-coord-1',
      source: 'kto-tour-jpn',
      sourcePlaceId: 'kto-6001',
      name: '연세대학교',
      location: null,
    });
    const p2 = makePlace({
      id: 'place-no-coord-2',
      source: 'naver-local',
      sourcePlaceId: 'naver-6002',
      name: '연세대학교',
      location: null,
    });

    const result = deduplicator.deduplicate([p1, p2]);
    expect(result.removedCount).toBe(0);
    expect(result.places).toHaveLength(2);
  });

  it('7. handles NAVER derived sourcePlaceId uniquely and preserves distinct places', () => {
    const derivedPlace1 = makePlace({
      id: 'naver-derived-1',
      source: 'naver-local',
      sourcePlaceId: 'derived:abc123hash',
      name: '어니언 성수',
      location: { type: 'Point', coordinates: [127.0577, 37.5445] },
    });
    const derivedPlace2 = makePlace({
      id: 'naver-derived-2',
      source: 'naver-local',
      sourcePlaceId: 'derived:xyz999hash',
      name: '대림창고',
      location: { type: 'Point', coordinates: [127.0583, 37.5421] },
    });

    const result = deduplicator.deduplicate([derivedPlace1, derivedPlace2]);
    expect(result.removedCount).toBe(0);
    expect(result.places).toHaveLength(2);
  });

  it('8. produces deterministic results across multiple invocations regardless of initial ordering', () => {
    const kto = makePlace({
      id: 'kto-1',
      source: 'kto-tour-jpn',
      sourcePlaceId: 'kto-det-1',
      name: '블루보틀 성수점',
      location: { type: 'Point', coordinates: [127.0441, 37.5478] },
    });
    const naver = makePlace({
      id: 'naver-1',
      source: 'naver-local',
      sourcePlaceId: 'naver-det-1',
      name: '블루보틀 성수점',
      location: { type: 'Point', coordinates: [127.0442, 37.5479] },
    });
    const other = makePlace({
      id: 'naver-other',
      source: 'naver-local',
      sourcePlaceId: 'naver-det-2',
      name: '로우키 성수',
      location: { type: 'Point', coordinates: [127.052, 37.543] },
    });

    const result1 = deduplicator.deduplicate([naver, other, kto]);
    const result2 = deduplicator.deduplicate([kto, naver, other]);
    const result3 = deduplicator.deduplicate([other, kto, naver]);

    expect(result1.places.map((p) => p.id)).toEqual(result2.places.map((p) => p.id));
    expect(result2.places.map((p) => p.id)).toEqual(result3.places.map((p) => p.id));
    expect(result1.removedCount).toBe(1);
    expect(result1.places.map((p) => p.id)).toEqual(['kto-1', 'naver-other']);
  });
});
