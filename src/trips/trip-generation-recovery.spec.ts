import { tripGenerationRecovery } from './trip-generation-recovery';

describe('tripGenerationRecovery', () => {
  it('offers a safe re-submit patch when a requested cuisine has no verified match', () => {
    const recovery = tripGenerationRecovery({
      reason: 'meal_cuisine_unavailable',
      dayNumber: 1,
      area: '성수',
    });

    expect(recovery.reason).toBe('meal_cuisine_unavailable');
    expect(recovery.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'meal_cuisine',
          requestPatch: { relaxations: ['meal_cuisine'] },
        }),
        expect.objectContaining({
          id: 'search_radius',
          requestPatch: { relaxations: ['search_radius'] },
        }),
      ]),
    );
  });

  it('does not offer an invented place as recovery for missing candidates', () => {
    const recovery = tripGenerationRecovery({
      reason: 'no_candidates',
      dayNumber: 2,
      area: '홍대',
    });

    expect(recovery.actions.map((item) => item.id)).toEqual(['search_radius', 'route_constraints']);
  });
});
