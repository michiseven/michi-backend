import { extractScopedActivityCounts } from './activity-count-contract';

export type ActivityCounts = Partial<
  Record<'cafe' | 'park' | 'restaurant' | 'culture' | 'attraction', number>
>;

/** User-stated conditions, not LLM or provider assertions. */
export interface ExplicitRequestContract {
  startDate?: string;
  partySize?: number;
  budget?: { amountKrw: number; scope: 'total' | 'per_person' };
  activityWindow?: { startTime: string; endTime: string; sourceRequest: string };
  /** Unscoped counts refer to the whole trip, not always its first day. */
  requiredActivityCounts?: ActivityCounts;
  dailyActivityCounts?: ActivityCounts;
  activityCountsByDay?: Record<number, ActivityCounts>;
  airport?: {
    role: 'arrival' | 'departure' | 'unknown';
    name: 'ICN' | 'GMP' | 'unspecified';
    terminal: 'T1' | 'T2' | null;
    deadline: string | null;
    arrivalDeadline: string | null;
    flightTime: string | null;
    sourceRequest: string;
  };
  luggage?: {
    requested: true;
    storageRequired: boolean;
    recoveryRequired: boolean;
    sourceRequest: string;
  };
  hotel?: { checkoutTime: string | null; sourceRequest: string };
}

function timeFromMatch(match: RegExpMatchArray | null, offset = 1): string | null {
  if (!match) return null;
  const hour = Number(match[offset]);
  const minute = Number(match[offset + 1] ?? match[offset + 2] ?? 0);
  return hour < 24 && minute < 60
    ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    : null;
}

const TIME_PATTERN =
  '(?<!\\d)(\\d{1,2})(?::(\\d{2})|\\s*(?:시|時)(?:\\s*(\\d{1,2})\\s*(?:분|分))?)';

function explicitActivityCounts(text: string): ExplicitRequestContract['requiredActivityCounts'] {
  const counts: NonNullable<ExplicitRequestContract['requiredActivityCounts']> = {};
  const categories: Array<[keyof typeof counts, string]> = [
    ['cafe', '카페|カフェ|cafe'],
    ['park', '공원|公園|parks?'],
    ['restaurant', '식당|음식점|맛집|レストラン|飲食店|restaurants?'],
    ['culture', '박물관|미술관|博物館|美術館|museums?|galleries'],
    ['attraction', '관광지|명소|観光地|観光スポット|attractions?'],
  ];
  const numbers: Record<string, number> = {
    한: 1,
    하나: 1,
    두: 2,
    둘: 2,
    세: 3,
    셋: 3,
    네: 4,
    넷: 4,
    다섯: 5,
    여섯: 6,
    일곱: 7,
    여덟: 8,
    아홉: 9,
    열: 10,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const numberPattern =
    '\\d+|하나|다섯|여섯|일곱|여덟|아홉|한|두|둘|세|셋|네|넷|열|[一二三四五六七八九十]';
  for (const [category, aliases] of categories) {
    const expression = new RegExp(
      `(?:${aliases})\\s*(?:을|를|は|を)?\\s*(${numberPattern})\\s*(?:곳|군데|개|軒|箇所|か所|ヶ所|つ|件|places?)`,
      'giu',
    );
    for (const match of text.matchAll(expression)) {
      const before = text.slice(Math.max(0, match.index - 16), match.index);
      const after = text.slice(match.index + match[0].length);
      // A study-cafe exclusion is not a requested ordinary cafe count. Names
      // like "스타벅스카페2호점" and people counters are not activity promises.
      if (category === 'cafe' && /스터디\s*$|study\s*$|スタディ\s*$/iu.test(before)) continue;
      if (/(?:안\s*갈|제외할|빼야\s*할|避ける)\s*$/u.test(before)) continue;
      if (
        /^\s*(?:은|는|을|를|には|は|を)?\s*(?:제외|빼|안\s*가|가지\s*않|不要|除外|行かない|なし|避け)/u.test(
          after,
        )
      )
        continue;
      const count = numbers[match[1]!] ?? Number(match[1]);
      if (Number.isSafeInteger(count) && count > 0)
        counts[category] = Math.max(counts[category] ?? 0, count);
    }
  }
  return Object.keys(counts).length ? counts : undefined;
}

export interface RequestContractAssessment {
  status: 'satisfied' | 'partial';
  unavailable: Array<{
    code: 'airport_terminal' | 'airport_transfer' | 'luggage_storage';
    status: 'evidence_unavailable';
    sourceRequest: string;
  }>;
}

export function seoulToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function extractExplicitRequestContract(
  text: string,
  now = new Date(),
): ExplicitRequestContract {
  const result: ExplicitRequestContract = {};
  Object.assign(result, extractScopedActivityCounts(text, explicitActivityCounts));
  const compactRange = text.match(
    /(?<!\d)(\d{1,2})\s*(?:~|〜|～|[-–])\s*(\d{1,2})\s*(?:시|時)(?!\d)/u,
  );
  const activityRange = text.match(
    new RegExp(
      `${TIME_PATTERN}\\s*(?:부터|から|~|〜|～|[-–])\\s*${TIME_PATTERN}\\s*(?:까지|まで)?`,
      'u',
    ),
  );
  const activityStart =
    timeFromMatch(activityRange) ??
    (compactRange && Number(compactRange[1]) < 24
      ? `${compactRange[1]!.padStart(2, '0')}:00`
      : null);
  const activityEnd =
    timeFromMatch(activityRange, 4) ??
    (compactRange && Number(compactRange[2]) < 24
      ? `${compactRange[2]!.padStart(2, '0')}:00`
      : null);
  if (activityStart && activityEnd)
    result.activityWindow = {
      startTime: activityStart,
      endTime: activityEnd,
      sourceRequest: activityRange?.[0] ?? compactRange![0],
    };
  const today = seoulToday(now);
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/u)?.[1];
  if (
    iso &&
    !Number.isNaN(Date.parse(iso)) &&
    new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso
  ) {
    result.startDate = iso;
  } else {
    const weekday = text.match(/(일|월|화|수|목|금|토)요일|([日月火水木金土])曜(?:日)?/u);
    if (weekday) {
      const index = weekday[1]
        ? '일월화수목금토'.indexOf(weekday[1])
        : '日月火水木金土'.indexOf(weekday[2]!);
      const date = new Date(`${today}T00:00:00Z`);
      let offset = (index - date.getUTCDay() + 7) % 7;
      if (/다음\s*주|来週/u.test(text))
        offset = 7 - ((date.getUTCDay() + 6) % 7) + ((index + 6) % 7);
      date.setUTCDate(date.getUTCDate() + offset);
      result.startDate = date.toISOString().slice(0, 10);
    } else if (/내일|明日/u.test(text)) {
      const date = new Date(`${today}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + 1);
      result.startDate = date.toISOString().slice(0, 10);
    } else if (/오늘|今日/u.test(text)) result.startDate = today;
  }
  const party = text.match(
    /(?<!\d)(\d{1,2})\s*(?:명|人)(?!당|あたり|当たり|\d|\s*(?:予算|あたり|当たり|\d))/u,
  );
  if (party && Number(party[1]) > 0) result.partySize = Number(party[1]);
  const adults = text.match(/(?:어른|성인|大人)\s*(\d+)\s*(?:명|人)?/u);
  const children = text.match(/(?:아이|어린이|子供|子ども)[^.!?。！？]{0,12}?(\d+)\s*(?:명|人)/u);
  if (adults && children) result.partySize = Number(adults[1]) + Number(children[1]);
  const money = text.match(
    /((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(만\s*원|만원|천\s*원|千ウォン|万ウォン|원|ウォン|KRW)/iu,
  );
  if (money) {
    const unit = money[2]!;
    const multiplier = /만|万/u.test(unit) ? 10_000 : /천|千/u.test(unit) ? 1_000 : 1;
    const amount = Number(money[1]!.replace(/,/gu, '')) * multiplier;
    if (Number.isSafeInteger(amount) && amount > 0) {
      result.budget = {
        amountKrw: amount,
        scope:
          /1\s*인(?:당)?\s*(?:예산|\d)|인당|명당|한\s*사람당|一人(?:あたり|当たり)|1\s*人(?:あたり|당|\s*(?:予算|\d))|per\s*person/iu.test(
            text,
          )
            ? 'per_person'
            : 'total',
      };
    }
  }
  if (/공항|空港|airport|인천|仁川|김포|金浦|\bICN\b|\bGMP\b/iu.test(text)) {
    const terminal = /(?:제?\s*1\s*(?:터미널|ターミナル)|\bT1\b)/iu.test(text)
      ? 'T1'
      : /(?:제?\s*2\s*(?:터미널|ターミナル)|\bT2\b)/iu.test(text)
        ? 'T2'
        : null;
    const deadlineMatch =
      text.match(
        new RegExp(`${TIME_PATTERN}\\s*(?:까지|まで)[^.!?。！？]{0,15}(?:공항|空港)`, 'u'),
      ) ??
      text.match(
        new RegExp(
          `(?:공항|空港|\\bICN\\b|\\bGMP\\b)[^.!?。！？]{0,30}${TIME_PATTERN}\\s*(?:까지|まで|도착|到着)`,
          'iu',
        ),
      ) ??
      text.match(new RegExp(`${TIME_PATTERN}\\s*(?:공항|空港)?\\s*(?:도착|到着)`, 'u'));
    const deadline = timeFromMatch(deadlineMatch);
    const flightTime = timeFromMatch(
      text.match(new RegExp(`${TIME_PATTERN}\\s*(?:비행(?:기)?|항공편|フライト|飛行機)`, 'u')) ??
        text.match(
          new RegExp(`(?:비행(?:기)?|항공편|フライト|飛行機)[^.!?。！？]{0,8}${TIME_PATTERN}`, 'u'),
        ),
    );
    result.airport = {
      role: /출국|출발|帰国|出発|departure|공항.*(?:도착|까지)|空港.*(?:到着|まで)/iu.test(text)
        ? 'departure'
        : /입국|入国|arrival/iu.test(text)
          ? 'arrival'
          : 'unknown',
      name: /인천|仁川|\bICN\b/iu.test(text)
        ? 'ICN'
        : /김포|金浦|\bGMP\b/iu.test(text)
          ? 'GMP'
          : 'unspecified',
      terminal,
      deadline,
      arrivalDeadline: deadline,
      flightTime,
      sourceRequest: text,
    };
  }
  if (/체크아웃|チェックアウト|check\s*out/iu.test(text))
    result.hotel = {
      checkoutTime: timeFromMatch(
        text.match(
          new RegExp(`${TIME_PATTERN}\\s*(?:체크아웃|チェックアウト|check\\s*out)`, 'iu'),
        ) ??
          text.match(
            new RegExp(
              `(?:체크아웃|チェックアウト|check\\s*out)[^.!?。！？]{0,8}${TIME_PATTERN}`,
              'iu',
            ),
          ),
      ),
      sourceRequest: text,
    };
  if (/짐|캐리어|荷物|スーツケース|luggage/iu.test(text))
    result.luggage = {
      requested: true,
      storageRequired: /보관|맡기|맡길|預け|預か|保管|storage/iu.test(text),
      recoveryRequired: /회수|찾(?:아|을|고)|取りに|受け取|pick\s*up|recover/iu.test(text),
      sourceRequest: text,
    };
  return result;
}

/** Current providers cannot prove terminal transfers or storage; never infer success. */
export function assessExplicitRequestContract(
  contract: ExplicitRequestContract,
  evidence: {
    airportTransferVerified?: boolean;
    luggageStorageVerified?: boolean;
    luggageRecoveryVerified?: boolean;
  } = {},
): RequestContractAssessment {
  const unavailable: RequestContractAssessment['unavailable'] = [];
  if (contract.airport) {
    if (contract.airport.name === 'ICN' && !contract.airport.terminal)
      unavailable.push({
        code: 'airport_terminal',
        status: 'evidence_unavailable',
        sourceRequest: contract.airport.sourceRequest,
      });
    if (!evidence.airportTransferVerified)
      unavailable.push({
        code: 'airport_transfer',
        status: 'evidence_unavailable',
        sourceRequest: contract.airport.sourceRequest,
      });
  }
  if (
    (contract.luggage?.storageRequired && !evidence.luggageStorageVerified) ||
    (contract.luggage?.recoveryRequired && !evidence.luggageRecoveryVerified)
  )
    unavailable.push({
      code: 'luggage_storage',
      status: 'evidence_unavailable',
      sourceRequest: contract.luggage.sourceRequest,
    });
  return { status: unavailable.length ? 'partial' : 'satisfied', unavailable };
}
