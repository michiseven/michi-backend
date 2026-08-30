import { completeRouteCost } from './trips.service';

describe('completeRouteCost', () => {
  it('sums the route only when every stop has a verified cost', () => {
    expect(completeRouteCost([{ estimatedCost: 8_000 }, { estimatedCost: 12_000 }])).toBe(20_000);
  });

  it('returns null when even one stop cost is unknown', () => {
    expect(completeRouteCost([{ estimatedCost: 8_000 }, { estimatedCost: null }])).toBeNull();
  });

  it('returns null for an empty route', () => {
    expect(completeRouteCost([])).toBeNull();
  });
});
