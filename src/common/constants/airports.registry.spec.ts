import { findVerifiedAirport, VERIFIED_AIRPORTS } from './airports.registry';

describe('AirportRegistry', () => {
  it('contains verified definitions for ICN T1, ICN T2, GMP INTL, and GMP DOM', () => {
    expect(VERIFIED_AIRPORTS).toHaveLength(4);
    const codes = VERIFIED_AIRPORTS.map((a) => a.code);
    expect(codes).toContain('ICN_T1');
    expect(codes).toContain('ICN_T2');
    expect(codes).toContain('GMP_INTL');
    expect(codes).toContain('GMP_DOM');
  });

  it('matches airports by exact code and IATA', () => {
    expect(findVerifiedAirport('ICN_T1')?.code).toBe('ICN_T1');
    expect(findVerifiedAirport('ICN_T2')?.code).toBe('ICN_T2');
    expect(findVerifiedAirport('GMP_INTL')?.code).toBe('GMP_INTL');
    expect(findVerifiedAirport('GMP_DOM')?.code).toBe('GMP_DOM');
  });

  it('matches Korean names and natural queries', () => {
    expect(findVerifiedAirport('인천공항')?.code).toBe('ICN_T1');
    expect(findVerifiedAirport('인천국제공항 제2여객터미널')?.code).toBe('ICN_T2');
    expect(findVerifiedAirport('김포공항')?.code).toBe('GMP_INTL');
    expect(findVerifiedAirport('김포공항 국내선')?.code).toBe('GMP_DOM');
  });

  it('matches Japanese and English queries', () => {
    expect(findVerifiedAirport('仁川空港')?.code).toBe('ICN_T1');
    expect(findVerifiedAirport('仁川第2ターミナル')?.code).toBe('ICN_T2');
    expect(findVerifiedAirport('金浦空港')?.code).toBe('GMP_INTL');
    expect(findVerifiedAirport('Incheon Airport')?.code).toBe('ICN_T1');
  });

  it('returns null for unrelated queries', () => {
    expect(findVerifiedAirport('성수동')).toBeNull();
    expect(findVerifiedAirport('')).toBeNull();
    expect(findVerifiedAirport(null)).toBeNull();
  });
});
