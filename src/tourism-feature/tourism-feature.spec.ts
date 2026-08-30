import { calculateLocalImpact } from './local-impact';
import { calculateTourismConcentration, percentileRank } from './tourism-concentration';

describe('tourism feature algorithms', () => {
  it('keeps concentration and dispersion directions opposite', () => {
    const lower = calculateTourismConcentration({
      visitor_count: { value: 10, peerValues: [10, 20, 30, 40] },
    });
    const higher = calculateTourismConcentration({
      visitor_count: { value: 40, peerValues: [10, 20, 30, 40] },
    });

    expect(lower.concentration).not.toBeNull();
    expect(higher.concentration).toBeGreaterThan(lower.concentration!);
    expect(higher.dispersion).toBeLessThan(lower.dispersion!);
    expect(lower.features.visitor_count?.effectiveWeight).toBe(1);
    expect(lower.dispersion).toBeCloseTo(1 - lower.concentration!, 6);
  });

  it('uses a deterministic midrank percentile and ignores invalid peers', () => {
    expect(percentileRank(20, [10, 20, 20, 30, null, Number.NaN])).toBe(0.5);
    expect(percentileRank(null, [10, 20])).toBeNull();
    expect(percentileRank(10, [null, Number.NaN])).toBeNull();
  });

  it('renormalizes only the available concentration feature weights', () => {
    const result = calculateTourismConcentration({
      visitor_count: { value: 30, peerValues: [10, 20, 30, 40] },
      concentration_forecast_index: { value: null, peerValues: [0.1, 0.2] },
      navigation_search_count: { value: 10, peerValues: [10, 20, 30, 40] },
    });

    expect(result.features.visitor_count?.effectiveWeight).toBeCloseTo(0.35 / 0.55, 8);
    expect(result.features.navigation_search_count?.effectiveWeight).toBeCloseTo(0.2 / 0.55, 8);
    expect(result.features.concentration_forecast_index).toBeUndefined();
  });

  it('applies local impact only after the preference hard gate', () => {
    const rejected = calculateLocalImpact({
      preferenceScore: 0.59,
      dispersion: 1,
      alternativeSimilarity: 1,
      tourismFlow: 1,
    });
    const accepted = calculateLocalImpact({
      preferenceScore: 0.6,
      dispersion: 0.8,
      alternativeSimilarity: null,
      tourismFlow: 0.4,
    });

    expect(rejected).toMatchObject({ eligible: false, score: null, effectiveWeights: {} });
    expect(accepted.eligible).toBe(true);
    expect(accepted.score).toBeCloseTo((0.8 * 0.5 + 0.4 * 0.2) / 0.7, 6);
    expect(accepted.effectiveWeights.alternativeSimilarity).toBeUndefined();
  });

  it('does not manufacture concentration or local impact when observations are unavailable', () => {
    expect(calculateTourismConcentration({})).toMatchObject({
      concentration: null,
      dispersion: null,
      features: {},
    });
    expect(
      calculateLocalImpact({
        preferenceScore: 0.9,
        dispersion: null,
        alternativeSimilarity: null,
        tourismFlow: null,
      }),
    ).toMatchObject({ eligible: true, score: null, effectiveWeights: {} });
  });
});
