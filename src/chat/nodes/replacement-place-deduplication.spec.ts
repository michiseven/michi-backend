import type { Place } from '../../database/entities';
import { deduplicateReplacementPlaces } from './replacement-place-deduplication';

const place = (id: string, overrides: Partial<Place> = {}): Place =>
  ({
    id,
    source: 'naver-local',
    sourcePlaceId: id,
    name: '비파티세리 공덕점',
    roadAddress: '서울특별시 마포구 마포대로 14길 23',
    location: { type: 'Point', coordinates: [126.951, 37.544] },
    ...overrides,
  }) as Place;

describe('replacement physical venue identity', () => {
  it('collapses 3 nearby duplicate records while retaining the representative existing ID and facts', () => {
    const first = place('first');
    const rows = [
      first,
      place('second', {
        source: 'kakao-local',
        location: { type: 'Point', coordinates: [126.95105, 37.544] },
      }),
      place('third', { location: { type: 'Point', coordinates: [126.95106, 37.544] } }),
      place('other', { name: '공덕 커피', roadAddress: '서울특별시 마포구 마포대로 15길 30' }),
    ];
    expect(deduplicateReplacementPlaces(rows).map((p) => p.id)).toEqual(['first', 'other']);
    expect(deduplicateReplacementPlaces(rows)[0]).toBe(first);
  });
  it('keeps nearby distinct branches and distinct addresses even when the brand is shared', () => {
    const rows = [
      place('gongdeok'),
      place('mapo', { name: '비파티세리 마포점' }),
      place('second-address', { roadAddress: '서울특별시 마포구 마포대로 14길 25' }),
    ];
    expect(deduplicateReplacementPlaces(rows)).toEqual(rows);
  });
  it('never treats empty provider identities, shared phone, proximity or name alone as identity', () => {
    const rows = [
      place('a', { source: '', sourcePlaceId: '', roadAddress: null, address: null }),
      place('b', { source: '', sourcePlaceId: '', roadAddress: null, address: null }),
      place('c', { name: '다른 카페', rawPayload: { sourceRecord: { phone: '02-1234-5678' } } }),
    ];
    expect(deduplicateReplacementPlaces(rows)).toEqual(rows);
  });
  it('accepts nonempty provider identity and requires coordinates for name/address evidence', () => {
    expect(
      deduplicateReplacementPlaces([
        place('a', { location: null }),
        place('b', { location: null }),
      ]),
    ).toHaveLength(2);
    expect(
      deduplicateReplacementPlaces([
        place('a', { sourcePlaceId: 'same', location: null }),
        place('b', { sourcePlaceId: 'same', location: null }),
      ]),
    ).toHaveLength(1);
    expect(
      deduplicateReplacementPlaces([
        place('a'),
        place('b', { location: { type: 'Point', coordinates: [126.955, 37.544] } }),
      ]),
    ).toHaveLength(2);
  });
});
