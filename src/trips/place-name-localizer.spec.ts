import { localizePlaceName } from './place-name-localizer';

describe('localizePlaceName', () => {
  it('localizes known mock fixtures for Korean responses', () => {
    expect(localizePlaceName('[MOCK] 焼肉店', 'ko')).toBe('[MOCK] 고깃집');
  });

  it('uses a verified Korean alias embedded in a KTO Japanese title', () => {
    expect(localizePlaceName('オンギンダル（옹근달）', 'ko')).toBe('옹근달');
  });

  it('does not invent a translation without a Korean alias', () => {
    expect(localizePlaceName('未知の場所', 'ko')).toBe('未知の場所');
  });

  it('preserves provider names for Japanese responses', () => {
    expect(localizePlaceName('[MOCK] 焼肉店', 'ja')).toBe('[MOCK] 焼肉店');
  });
});
