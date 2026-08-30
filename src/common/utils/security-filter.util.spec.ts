import { isNorthKoreaRelated } from './security-filter.util';

describe('security-filter.util', () => {
  it('should identify North Korea related terms', () => {
    expect(isNorthKoreaRelated('북한 대사관')).toBe(true);
    expect(isNorthKoreaRelated('DMZ 안보 관광')).toBe(true);
    expect(isNorthKoreaRelated('판문점 투어')).toBe(true);
    expect(isNorthKoreaRelated('임진각 평화누리공원')).toBe(true);
    expect(isNorthKoreaRelated('제3땅굴 관람')).toBe(true);
    expect(isNorthKoreaRelated('DPRK Tour')).toBe(true);
    expect(isNorthKoreaRelated('North Korea Museum')).toBe(true);
    expect(isNorthKoreaRelated('탈북민 식당')).toBe(true);
    expect(isNorthKoreaRelated('도라산역')).toBe(true);
    expect(isNorthKoreaRelated('통일전망대')).toBe(true);
  });

  it('should allow normal Seoul places and Bukhansan Mountain', () => {
    expect(isNorthKoreaRelated('북한산 국립공원')).toBe(false);
    expect(isNorthKoreaRelated('북한산성 코스')).toBe(false);
    expect(isNorthKoreaRelated('성수동 카페')).toBe(false);
    expect(isNorthKoreaRelated('명동 교자')).toBe(false);
    expect(isNorthKoreaRelated('한남동 브리즈서울')).toBe(false);
    expect(isNorthKoreaRelated(null)).toBe(false);
    expect(isNorthKoreaRelated('')).toBe(false);
  });
});
