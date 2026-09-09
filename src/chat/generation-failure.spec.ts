import { UnprocessableEntityException } from '@nestjs/common';
import { generationFailure } from './generation-failure';

describe('generationFailure', () => {
  it('keeps an actionable stable code and Japanese chips without leaking internal detail', () => {
    const failure = generationFailure(
      new UnprocessableEntityException({
        code: 'MEAL_CUISINE_NOT_FOUND',
        message: 'internal detail',
      }),
      'ja',
    );
    expect(failure.code).toBe('MEAL_CUISINE_NOT_FOUND');
    expect(failure.message).toContain('料理');
    expect(failure.message).not.toContain('internal detail');
    expect(failure.chips.length).toBeLessThanOrEqual(3);
    expect(failure.chips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '料理を変更',
          requestPatch: { relaxations: ['meal_cuisine'] },
        }),
      ]),
    );
  });

  it.each(['INSUFFICIENT_VERIFIED_COVERAGE', 'MEAL_EVIDENCE_MISSING', 'THEME_EVIDENCE_MISSING'])(
    'maps completion gate %s to a distinct Japanese recovery response',
    (code) => {
      const failure = generationFailure(new UnprocessableEntityException({ code }), 'ja');
      expect(failure.code).toBe(code);
      expect(failure.chips.length).toBeGreaterThan(0);
    },
  );

  it('keeps known codes, fully localizes Korean recovery, and marks a theme change as user-edit only', () => {
    const failure = generationFailure(
      new UnprocessableEntityException({ code: 'THEME_EVIDENCE_MISSING' }),
      'ko',
    );
    expect(failure.code).toBe('THEME_EVIDENCE_MISSING');
    expect(failure.message).toContain('테마');
    expect(failure.chips).toEqual([
      expect.objectContaining({
        label: '테마를 수정하기',
        requiresUserEdit: true,
      }),
    ]);
    expect(failure.chips[0]?.requestPatch).toBeUndefined();
    expect(failure.chips.map((chip) => `${chip.label} ${chip.query}`).join(' ')).not.toMatch(
      /[ぁ-んァ-ン]/u,
    );
  });

  it.each([
    'CATEGORY_CANDIDATES_NOT_FOUND',
    'NO_UNIQUE_PLACE_CANDIDATES',
    'ROUTE_CONSTRAINTS_VIOLATED',
  ])('preserves known source code %s rather than collapsing it', (code) => {
    const failure = generationFailure(new UnprocessableEntityException({ code }), 'ja');
    expect(failure.code).toBe(code);
    for (const chip of failure.chips.filter((chip) => !chip.requiresUserEdit)) {
      expect(chip.requestPatch).toBeDefined();
    }
  });

  it('exposes the structured area stage and only a user-edit recovery', () => {
    const failure = generationFailure(
      new UnprocessableEntityException({
        code: 'AREA_FILTER_UNAVAILABLE',
        recovery: {
          reason: 'no_candidates',
          dayNumber: 1,
          area: '홍대',
          stage: 'area',
          affectedRequirement: 'area',
          diagnostics: { fetched: 4, unique: 4, insideAllowedArea: 0 },
          actions: [],
        },
        validation: {
          publicationStatus: 'blocked',
          requiredActivities: { status: 'pass', missing: [] },
          area: { status: 'fail', outsidePlaceIds: ['outside-1'] },
          time: { status: 'pass', violations: [] },
          failureCodes: ['AREA_CONSTRAINTS_VIOLATED'],
        },
      }),
      'ko',
    );

    expect(failure.code).toBe('AREA_FILTER_UNAVAILABLE');
    expect(failure.stage).toBe('area');
    expect(failure.diagnostics).toEqual({ fetched: 4, unique: 4, insideAllowedArea: 0 });
    expect(failure.validation?.publicationStatus).toBe('blocked');
    expect(failure.chips).toEqual([
      expect.objectContaining({ requiresUserEdit: true, label: '지역을 직접 수정하기' }),
    ]);
  });

  it('distinguishes a provider outage from candidate or route constraints', () => {
    const failure = generationFailure(
      new UnprocessableEntityException({
        code: 'PLACE_PROVIDER_UNAVAILABLE',
        recovery: {
          reason: 'provider_unavailable',
          dayNumber: 1,
          area: '홍대',
          stage: 'candidate',
          affectedRequirement: 'candidate',
          diagnostics: { provider: 'naver-local', operation: '장소 검색' },
          actions: [],
        },
      }),
      'ja',
    );

    expect(failure.code).toBe('PLACE_PROVIDER_UNAVAILABLE');
    expect(failure.stage).toBe('candidate');
    expect(failure.diagnostics?.provider).toBe('naver-local');
    expect(failure.chips).toEqual([
      expect.objectContaining({ label: '同じ条件で再試行', type: 'refine' }),
    ]);
  });
});
