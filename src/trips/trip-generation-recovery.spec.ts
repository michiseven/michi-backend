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

  it('returns only an area decision when the requested boundary cannot be resolved', () => {
    const recovery = tripGenerationRecovery({
      reason: 'no_candidates',
      dayNumber: 1,
      area: '홍대',
      stage: 'area',
      affectedRequirement: 'area',
      diagnostics: { fetched: 7, unique: 5, insideAllowedArea: 0 },
    });

    expect(recovery.stage).toBe('area');
    expect(recovery.diagnostics?.insideAllowedArea).toBe(0);
    expect(recovery.actions).toEqual([]);
  });

  it('does not suggest route relaxation for a role-level failure', () => {
    const recovery = tripGenerationRecovery({
      reason: 'no_candidates',
      dayNumber: 1,
      area: '명동',
      stage: 'role',
      affectedRequirement: 'stroll',
    });

    expect(recovery.actions.map((item) => item.id)).toEqual(['search_radius']);
  });

  it('keeps provider outages distinct and does not suggest a preference relaxation', () => {
    const recovery = tripGenerationRecovery({
      reason: 'provider_unavailable',
      dayNumber: 1,
      area: '홍대',
      stage: 'candidate',
      affectedRequirement: 'candidate',
      diagnostics: { provider: 'naver-local', operation: '장소 검색' },
    });

    expect(recovery.diagnostics).toEqual({ provider: 'naver-local', operation: '장소 검색' });
    expect(recovery.actions).toEqual([]);
  });
});
