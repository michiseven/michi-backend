import { matchesExactPlaceIdentity } from './place-identity';

describe('explicit landmark identity', () => {
  it.each(['스타벅스 경복궁사거리점', '경복궁 카페', '경복궁역'])(
    'rejects %s for the palace',
    (name) => {
      expect(matchesExactPlaceIdentity('경복궁', name)).toBe(false);
      expect(matchesExactPlaceIdentity('景福宮', name)).toBe(false);
    },
  );
  it.each(['경복궁', '경복궁(景福宮)', 'Gyeongbokgung Palace'])(
    'accepts verified alias %s',
    (name) => {
      expect(matchesExactPlaceIdentity('景福宮', name)).toBe(true);
    },
  );
  it('does not substitute a restaurant or sub-venue for Seoul Forest', () => {
    expect(matchesExactPlaceIdentity('서울숲', '서울숲 카페')).toBe(false);
    expect(matchesExactPlaceIdentity('ソウルの森', '서울숲')).toBe(true);
    expect(matchesExactPlaceIdentity('', '서울숲')).toBe(false);
  });
});
