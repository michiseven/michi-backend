import type { RouteLegEstimate } from '../routing/routing-provider';

interface ScheduledStop {
  arrivalAt: string;
  leaveAt: string;
  inboundRoute?: RouteLegEstimate | null;
}

const MIN_DISCLOSED_GAP_MINUTES = 30;

function seoulClock(timestamp: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
}

/** Disclose large internal gaps from saved times without allocating new activities. */
export function routeUnassignedGapWarnings(stops: ScheduledStop[], locale: 'ko' | 'ja'): string[] {
  const ordered = [...stops].sort((a, b) => Date.parse(a.arrivalAt) - Date.parse(b.arrivalAt));
  return ordered.slice(1).flatMap((next, index) => {
    const previousLeave = Date.parse(ordered[index]!.leaveAt);
    const nextArrival = Date.parse(next.arrivalAt);
    const gapMinutes = Math.floor((nextArrival - previousLeave) / 60_000);
    if (!Number.isFinite(gapMinutes) || gapMinutes < MIN_DISCLOSED_GAP_MINUTES) return [];
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(previousLeave));
    const interval = `${date} ${seoulClock(previousLeave)}–${seoulClock(nextArrival)}`;
    const leg = next.inboundRoute;
    const measured =
      leg &&
      leg.evidence === 'measured' &&
      Number.isFinite(leg.durationMinutes) &&
      leg.durationMinutes >= 0 &&
      leg.durationMinutes <= gapMinutes;
    if (measured) {
      const remaining = Math.floor(gapMinutes - leg.durationMinutes);
      if (remaining < MIN_DISCLOSED_GAP_MINUTES) return [];
      return [
        locale === 'ja'
          ? `${interval}の${gapMinutes}分には、経路データによる移動${leg.durationMinutes}分と、計画上の移動以外の余裕${remaining}分があります。余裕時間を過ごす場所や開始時刻は決まっていません。`
          : `${interval} 사이 ${gapMinutes}분에는 경로 데이터에 따른 이동 ${leg.durationMinutes}분과 계획상 이동 외 여유 ${remaining}분이 있습니다. 여유 시간을 보낼 장소와 시작 시각은 정해지지 않았습니다.`,
      ];
    }
    return [
      locale === 'ja'
        ? `${interval}は活動が未割り当ての${gapMinutes}分間です（移動時間を含みます）。移動時間の確認済み根拠がないため、自由時間は算定できません。`
        : `${interval}은 활동 미배정 ${gapMinutes}분 구간입니다(이동시간 포함). 이동시간의 확인된 근거가 없어 자유 시간을 산정할 수 없습니다.`,
    ];
  });
}

export function isUnassignedGapWarning(warning: string): boolean {
  return /활동 미배정|活動が未割り当て|계획상 이동 외 여유|計画上の移動以外の余裕/u.test(warning);
}
