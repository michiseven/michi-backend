import { extractBrandKey } from './brand-extractor';

describe('extractBrandKey', () => {
  it('extracts known franchise brand keys regardless of branch name or casing', () => {
    expect(extractBrandKey({ name: '스타벅스 무교로점' })).toBe('스타벅스');
    expect(extractBrandKey({ name: '스타벅스 무교동점' })).toBe('스타벅스');
    expect(extractBrandKey({ name: 'Starbucks Coffee Gwanghwamun' })).toBe('starbucks');
    expect(extractBrandKey({ name: '투썸플레이스 을지로입구역점' })).toBe('투썸');
    expect(extractBrandKey({ name: '이디야커피 시청점' })).toBe('이디야');
    expect(extractBrandKey({ name: '올리브영 명동본점' })).toBe('올리브영');
    expect(extractBrandKey({ name: '블루보틀 삼청 카페' })).toBe('블루보틀');
    expect(extractBrandKey({ name: '파리바게뜨 종로점' })).toBe('파리바게뜨');
  });

  it('extracts generic brand names ending in branch designations', () => {
    expect(extractBrandKey({ name: '어니언 성수점' })).toBe('어니언');
    expect(extractBrandKey({ name: '대림창고 갤러리점' })).toBe('대림창고');
    expect(extractBrandKey({ name: '마일스톤커피 한남직영점' })).toBe('마일스톤커피');
  });

  it('returns null for unique independent local places without branch names', () => {
    expect(extractBrandKey({ name: '서울도서관' })).toBeNull();
    expect(extractBrandKey({ name: '경복궁' })).toBeNull();
    expect(extractBrandKey({ name: '일민미술관' })).toBeNull();
    expect(extractBrandKey({ name: '덕수궁 돌담길' })).toBeNull();
  });
});
