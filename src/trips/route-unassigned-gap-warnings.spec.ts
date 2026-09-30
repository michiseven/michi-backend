import { routeUnassignedGapWarnings } from './route-unassigned-gap-warnings';
import type { RouteLegEstimate } from '../routing/routing-provider';

function leg(evidence: RouteLegEstimate['evidence'], durationMinutes = 6): RouteLegEstimate {
  return {
    evidence,
    durationMinutes,
    distanceKm: 0.4,
    method: 'straight-line-walking-estimate',
    transportMode: 'walk',
    disclaimer: 'fixture',
  };
}

function stops(
  inboundRoute?: RouteLegEstimate | null,
  arrivalAt = '2026-10-03T08:00:00.000Z',
): Array<{ arrivalAt: string; leaveAt: string; inboundRoute?: RouteLegEstimate | null }> {
  return [
    { arrivalAt: '2026-10-03T04:00:00.000Z', leaveAt: '2026-10-03T05:00:00.000Z' },
    { arrivalAt, leaveAt: '2026-10-03T09:00:00.000Z', inboundRoute },
  ];
}

describe('routeUnassignedGapWarnings', () => {
  it.each(['ko', 'ja'] as const)(
    'discloses the full 14–17 interval with estimated travel in %s',
    (locale) => {
      const [warning] = routeUnassignedGapWarnings(stops(leg('estimated')), locale);
      expect(warning).toContain('14:00–17:00');
      expect(warning).toContain('180');
      expect(warning).toContain(locale === 'ko' ? '이동시간 포함' : '移動時間を含みます');
      expect(warning).toContain(locale === 'ko' ? '산정할 수 없습니다' : '算定できません');
      expect(warning).not.toContain('174');
    },
  );
  it.each(['measured'] as const)('separates plan slack using %s route evidence', (evidence) => {
    for (const locale of ['ko', 'ja'] as const) {
      const [warning] = routeUnassignedGapWarnings(stops(leg(evidence)), locale);
      expect(warning).toContain('180');
      expect(warning).toContain('174');
      expect(warning).toContain(locale === 'ko' ? '계획상 이동 외 여유' : '計画上の移動以外の余裕');
      expect(warning).toContain(locale === 'ko' ? '시작 시각은 정해지지' : '開始時刻は決まって');
    }
  });
  it.each([
    null,
    undefined,
    leg('unavailable'),
    leg('mixed'),
    leg('measured', NaN),
    leg('mixed', -1),
    leg('measured', 181),
  ])('does not calculate free time without usable travel evidence: %s', (inboundRoute) => {
    expect(routeUnassignedGapWarnings(stops(inboundRoute), 'ko')[0]).toContain('활동 미배정 180분');
  });
  it('does not flag ordinary travel or gaps shorter than thirty minutes', () => {
    expect(
      routeUnassignedGapWarnings(stops(leg('estimated'), '2026-10-03T05:06:00.000Z'), 'ko'),
    ).toEqual([]);
    expect(routeUnassignedGapWarnings(stops(leg('measured', 151)), 'ko')).toEqual([]);
    expect(routeUnassignedGapWarnings(stops(null, '2026-10-03T05:29:00.000Z'), 'ko')).toEqual([]);
    expect(routeUnassignedGapWarnings(stops(leg('measured', 150)), 'ko')[0]).toContain('여유 30분');
  });
  it('preserves input times and travel evidence and tolerates unsorted or invalid stops', () => {
    const original = stops(leg('estimated'));
    const snapshot = JSON.stringify(original);
    expect(routeUnassignedGapWarnings([...original].reverse(), 'ko')).toEqual(
      routeUnassignedGapWarnings(original, 'ko'),
    );
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(
      routeUnassignedGapWarnings(
        [{ arrivalAt: 'invalid', leaveAt: 'invalid' }, original[1]!],
        'ko',
      ),
    ).toEqual([]);
    expect(routeUnassignedGapWarnings([], 'ko')).toEqual([]);
  });
});
