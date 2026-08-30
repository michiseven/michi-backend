import { Injectable } from '@nestjs/common';
import type { TripPreferenceParser } from './preference-parser';
import type {
  DayTripPreference,
  ParsedTripPreference,
  PreferenceParseInput,
  PreferenceParseResult,
} from './preference.types';
import { TripPreferenceSchemaValidator } from './trip-preference-schema.validator';

const SEOUL_DISTRICTS = [
  '강남구',
  '강동구',
  '강북구',
  '강서구',
  '관악구',
  '광진구',
  '구로구',
  '금천구',
  '노원구',
  '도봉구',
  '동대문구',
  '동작구',
  '마포구',
  '서대문구',
  '서초구',
  '성동구',
  '성북구',
  '송파구',
  '양천구',
  '영등포구',
  '용산구',
  '은평구',
  '종로구',
  '중구',
  '중랑구',
  '강남',
  '강동',
  '강북',
  '강서',
  '관악',
  '광진',
  '구로',
  '금천',
  '노원',
  '도봉',
  '동대문',
  '동작',
  '마포',
  '서대문',
  '서초',
  '성동',
  '성북',
  '송파',
  '양천',
  '영등포',
  '용산',
  '은평',
  '종로',
  '중랑',
  '성수',
  '홍대',
  '공덕',
  '명동',
  '이태원',
  '을지로',
  '한남',
  '잠실',
  '북촌',
  '익선동',
  '여의도',
  '망원',
  '연남',
  '문래',
  '삼청동',
  '서촌',
  '인사동',
  '가로수길',
  '압구정',
  '청담',
  '聖水',
  '弘大',
  '孔徳',
  '明洞',
  '梨泰院',
  '乙支路',
  '漢南',
  '蚕室',
  '北村',
  '益善洞',
  '汝矣島',
  '望遠',
  '延南',
  '文来',
  '三清洞',
  '西村',
  '仁寺洞',
  'カロスキル',
  '狎鴎亭',
  '清潭',
  '江南',
  '鍾路',
  '鐘路',
  '東大門',
];

const AREA_KEYWORDS: Record<string, string> = {
  한남: '한남',
  성수: '성수',
  서촌: '서촌',
  경복궁: '경복궁',
  공덕: '공덕',
  마포: '마포',
  홍대: '홍대',
  명동: '명동',
  을지로: '을지로',
  강남: '강남',
  잠실: '잠실',
  망원: '망원',
  연남: '연남',
  이태원: '이태원',
  북촌: '북촌',
  익선동: '익선동',
  삼청동: '서촌',
  인사동: '종로',
  종로: '종로',
  동대문: '동대문',
  여의도: '여의도',
  狎鴎亭: '압구정',
  カロスキル: '신사',
  聖水: '성수',
  弘大: '홍대',
  孔徳: '공덕',
  明洞: '명동',
  梨泰院: '이태원',
  乙支路: '을지로',
  漢南: '한남',
  西村: '서촌',
  北村: '북촌',
  江南: '강남',
  東大門: '동대문',
};

function extractAreaFromText(text: string): string | null {
  for (const candidate of SEOUL_DISTRICTS) {
    if (text.includes(candidate)) {
      return candidate;
    }
  }
  const match = text.match(/([가-힣]{1,6}(?:구|동|로))/);
  if (match?.[1]) {
    return match[1];
  }
  return null;
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function budgetFromText(text: string): number | null {
  const manwonMatch = text.match(/(\d+)\s*만\s*원/);
  if (manwonMatch?.[1]) {
    return parseInt(manwonMatch[1], 10) * 10_000;
  }
  const rawWonMatch = text.match(/(\d{1,3}(?:,\d{3})+|\d{4,9})\s*(?:원|KRW|₩)/);
  if (rawWonMatch?.[1]) {
    return parseInt(rawWonMatch[1].replace(/,/g, ''), 10);
  }
  const yenMatch = text.match(/(\d+)\s*万\s*円/);
  if (yenMatch?.[1]) {
    return parseInt(yenMatch[1], 10) * 100_000;
  }
  return null;
}

function timeFromText(text: string, position: 'start' | 'end'): string | null {
  const rangeMatch = text.match(
    /(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)\s*(?:から|~|〜|～|-|부터)\s*([01]?\d|2[0-3]):([0-5]\d)(?:\s*(?:まで|까지))?/,
  );
  if (rangeMatch) {
    if (position === 'start') {
      return `${rangeMatch[1]!.padStart(2, '0')}:${rangeMatch[2]!}`;
    } else {
      return `${rangeMatch[3]!.padStart(2, '0')}:${rangeMatch[4]!}`;
    }
  }

  const hourRangeMatch = text.match(
    /(?:^|\D)([01]?\d|2[0-3])(?:\s*시|\s*時)\s*(?:から|~|〜|～|-|부터)\s*([01]?\d|2[0-3])(?:\s*시|\s*時)(?:\s*(?:まで|까지))?/,
  );
  if (hourRangeMatch) {
    if (position === 'start') {
      return `${hourRangeMatch[1]!.padStart(2, '0')}:00`;
    } else {
      return `${hourRangeMatch[2]!.padStart(2, '0')}:00`;
    }
  }

  if (position === 'start') {
    const startMatch =
      text.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)\s*(?:부터|から|시작)/) ||
      text.match(/(?:출발|시작|오전|아침|낮)\s*([01]?\d|2[0-3]):([0-5]\d)/) ||
      text.match(/(?:출발|시작|오전|아침|낮)\s*([01]?\d|2[0-3])(?:\s*시|\s*時)/);
    if (startMatch) {
      const hour = startMatch[1]!.padStart(2, '0');
      const min = startMatch[2] ?? '00';
      return `${hour}:${min}`;
    }
  } else {
    const endMatch =
      text.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)\s*(?:까지|まで|종료)/) ||
      text.match(/(?:도착|종료|오후|저녁|밤)\s*([01]?\d|2[0-3]):([0-5]\d)/) ||
      text.match(/(?:도착|종료|오후|저녁|밤)\s*([01]?\d|2[0-3])(?:\s*시|\s*時)/);
    if (endMatch) {
      const hour = endMatch[1]!.padStart(2, '0');
      const min = endMatch[2] ?? '00';
      return `${hour}:${min}`;
    }
  }
  return null;
}

const CONCERT_VENUES: Record<string, { name: string; defaultArea: string }> = {
  kspo: { name: 'KSPO DOME', defaultArea: '송파' },
  'kspo dome': { name: 'KSPO DOME', defaultArea: '송파' },
  올림픽체조경기장: { name: 'KSPO DOME', defaultArea: '송파' },
  체조경기장: { name: 'KSPO DOME', defaultArea: '송파' },
  올림픽공원: { name: '올림픽공원', defaultArea: '송파' },
  고척돔: { name: '고척스카이돔', defaultArea: '구로' },
  고척스카이돔: { name: '고척스카이돔', defaultArea: '구로' },
  잠실주경기장: { name: '잠실종합운동장', defaultArea: '잠실' },
  잠실실내체육관: { name: '잠실실내체육관', defaultArea: '잠실' },
  상암월드컵경기장: { name: '서울월드컵경기장', defaultArea: '마포' },
  블루스퀘어: { name: '블루스퀘어', defaultArea: '한남' },
};

function extractAnchorVenue(text: string): { name: string; defaultArea: string } | null {
  const lower = text.toLowerCase();
  for (const [key, venue] of Object.entries(CONCERT_VENUES)) {
    if (lower.includes(key)) return venue;
  }
  return null;
}

@Injectable()
export class MockTripPreferenceParser implements TripPreferenceParser {
  constructor(private readonly schema: TripPreferenceSchemaValidator) {}

  async parse(input: PreferenceParseInput): Promise<PreferenceParseResult> {
    const interests = [
      ...(includesAny(input.text, ['カフェ', 'cafe', '커피', '카페']) ? ['cafe'] : []),
      ...(includesAny(input.text, ['セレクトショップ', '쇼핑', '편집샵', '편집숍', '디자이너'])
        ? ['select_shop', 'shopping']
        : []),
      ...(includesAny(input.text, ['焼肉', '고기', '갈비', '맛집', '식당', '음식'])
        ? ['meat', 'food']
        : []),
      ...(includesAny(input.text, ['公園', '공원', '서울숲', '산책']) ? ['park'] : []),
      ...(includesAny(input.text, [
        '博物館',
        '美術館',
        '文化',
        '박물관',
        '미술관',
        '문화',
        '갤러리',
        '고궁',
        '한옥',
      ])
        ? ['culture']
        : []),
    ];

    const hasWalkingConstraint =
      includesAny(input.text, [
        '足が痛',
        '足痛',
        'あまり歩きたくない',
        '歩けない',
        '散歩が苦手',
        '歩くの苦手',
        '歩くのが苦手',
        '다리아파',
        '다리 아파',
        '다리 아프',
        '다리가 아파',
        '무릎',
        '많이 못 걸',
        '많이 못걸',
        '도보 적게',
        '도보 최소',
        '걷기 싫',
        '가까운 곳',
        '가까운데',
        '가까운 데',
        'short_walk',
        'minimal_walk',
      ]) || input.text.includes('long_walk');

    const avoidTags: string[] = [
      ...(includesAny(input.text, ['人が多', '混雑', '人混み', '붐비', '사람 많', '복잡'])
        ? [
            includesAny(input.text, [
              '大嫌い',
              '本当に嫌',
              '絶対嫌',
              '絶対に嫌',
              '정말 싫',
              '매우 싫',
            ])
              ? 'very_crowded'
              : 'crowded',
          ]
        : []),
      ...(hasWalkingConstraint ? ['long_walk'] : []),
    ];

    const detectedVenue = extractAnchorVenue(input.text);
    const extractedArea =
      input.startArea?.trim() ||
      extractAreaFromText(input.text) ||
      detectedVenue?.defaultArea ||
      null;
    const targetTimeMatch = input.text.match(
      /(?:^|\D)([01]?\d|2[0-3])(?::([0-5]\d)|時)\s*(?:に|まで|전|까지|까지는|までには|から|시)/,
    );
    const targetHour = targetTimeMatch?.[1]?.padStart(2, '0');
    const targetMinute = targetTimeMatch?.[2] ?? '00';
    const parsedTargetTime = targetHour ? `${targetHour}:${targetMinute}` : null;

    const anchorPlace = detectedVenue
      ? {
          name: detectedVenue.name,
          targetTime: parsedTargetTime ?? '18:00',
          role: 'destination' as const,
        }
      : null;

    const stayMatch = input.text.match(/(\d+)\s*(?:박|泊)\s*(\d+)\s*(?:일|日)/);
    const dayCountMatch = input.text.match(/(\d+)\s*(?:일간|日間|일 동안)/);
    let totalDays = 1;
    if (stayMatch && stayMatch[2]) {
      totalDays = parseInt(stayMatch[2], 10);
    } else if (dayCountMatch && dayCountMatch[1]) {
      totalDays = parseInt(dayCountMatch[1], 10);
    } else if (input.startDate && input.endDate) {
      const startMs = new Date(`${input.startDate}T00:00:00+09:00`).getTime();
      const endMs = new Date(`${input.endDate}T00:00:00+09:00`).getTime();
      const diffDays = Math.round((endMs - startMs) / (86400 * 1000)) + 1;
      if (diffDays > 0) totalDays = diffDays;
    }

    const todaySeoul = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const currentYear = todaySeoul.slice(0, 4);

    let startDate = input.startDate ?? input.travelDate ?? todaySeoul;
    const dateRangeMatch = input.text.match(
      /(\d{1,2})월\s*(\d{1,2})일.*?(?:부터|~|-).*?(\d{1,2})일/,
    );
    if (
      !input.startDate &&
      !input.travelDate &&
      dateRangeMatch &&
      dateRangeMatch[1] &&
      dateRangeMatch[2]
    ) {
      startDate = `${currentYear}-${dateRangeMatch[1].padStart(2, '0')}-${dateRangeMatch[2].padStart(2, '0')}`;
    }

    const dateList: string[] = [];
    for (let i = 0; i < totalDays; i++) {
      const [year, month, day] = startDate.split('-').map(Number);
      const d = new Date(Date.UTC(year!, month! - 1, day! + i));
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      dateList.push(`${y}-${m}-${dd}`);
    }
    const endDate =
      input.endDate ?? (totalDays > 1 ? dateList[dateList.length - 1] : startDate) ?? startDate;

    const partySize = includesAny(input.text, ['친구와 둘', '둘이', '2명', '2人', '二人', '두 명'])
      ? 2
      : 1;
    const totalBudget = input.budget ?? budgetFromText(input.text) ?? totalDays * 80_000;

    let baseCamp: ParsedTripPreference['baseCamp'] = null;
    let airport: string | null = null;

    if (input.airport) {
      if (input.airport === 'ICN_T1' || input.airport.includes('제1')) {
        airport = '인천국제공항 제1여객터미널';
      } else if (input.airport === 'ICN_T2' || input.airport.includes('제2')) {
        airport = '인천국제공항 제2여객터미널';
      } else if (input.airport === 'GMP' || input.airport.includes('김포')) {
        airport = '김포국제공항';
      } else {
        airport = input.airport;
      }
    } else if (/인천공항|인천국제공항|ICN|Incheon/i.test(input.text)) {
      if (/제2여객터미널|T2|2터미널/i.test(input.text)) {
        airport = '인천국제공항 제2여객터미널';
      } else {
        airport = '인천국제공항 제1여객터미널';
      }
    } else if (/김포공항|김포국제공항|GMP|Gimpo/i.test(input.text)) {
      airport = '김포국제공항';
    }

    const hotelMatch = input.text.match(
      /([가-힣A-Za-z0-9\s]+(?:호텔|숙소|게스트하우스|에어비앤비|Hotel))/,
    );
    const hotelName =
      input.hotel?.trim() ||
      (hotelMatch
        ? hotelMatch[1]!.trim()
        : includesAny(input.text, ['공덕역', '공덕 숙소', '마포 숙소', '공덕'])
          ? '롯데시티호텔 마포'
          : null);
    if (hotelName) {
      baseCamp = {
        name: hotelName,
        checkInTime: '15:00',
        checkOutTime: '11:00',
        dailyReturnTime: '21:30',
      };
    }

    const mobilityConstraint: ParsedTripPreference['mobilityConstraint'] = {
      maxWalkMinutesPerLeg: hasWalkingConstraint ? 15 : 25,
      avoidSteepInclineOrStairs:
        hasWalkingConstraint || includesAny(input.text, ['계단', '오르막', '階段', '坂道']),
      preferredTransit: 'subway',
    };

    const days: DayTripPreference[] = [];

    // 일자별 헤더 분할 패턴
    const daySplitRegex =
      /(?:첫날|첫\s*째\s*날|1일차|Day\s*1|1日目|\b18일\b)|(?:둘째\s*날|2일차|Day\s*2|2日目|\b19일\b)|(?:셋째\s*날|3일차|Day\s*3|3日目|\b20일\b)|(?:넷째\s*날|4일차|Day\s*4|4日目|\b21일\b)|(?:마지막\s*날|최종일)/i;
    const rawDayChunks = input.text
      .split(daySplitRegex)
      .filter((chunk) => chunk && chunk.trim().length > 0);

    // 텍스트 전체에서 언급된 지역들 추출
    const foundAreas: string[] = [];
    for (const [kw, normalizedArea] of Object.entries(AREA_KEYWORDS)) {
      if (input.text.includes(kw) && !foundAreas.includes(normalizedArea)) {
        foundAreas.push(normalizedArea);
      }
    }
    if (foundAreas.length === 0) {
      foundAreas.push(extractedArea || '서울');
    }

    for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
      const dayNum = dayIndex + 1;
      const dayDate = dateList[dayIndex] ?? startDate;
      const dayChunk = rawDayChunks[dayIndex] ?? input.text;

      // 일자별 지역 결정
      let dayArea = foundAreas[dayIndex % foundAreas.length] || extractedArea || '서울';
      for (const [kw, normalizedArea] of Object.entries(AREA_KEYWORDS)) {
        if (dayChunk.includes(kw)) {
          dayArea = normalizedArea;
          break;
        }
      }

      // 일자별 시작/종료 시간
      let dayStartTime = input.startTime ?? timeFromText(dayChunk, 'start') ?? '10:30';
      let dayEndTime = input.endTime ?? timeFromText(dayChunk, 'end') ?? '21:00';
      if (dayNum === 1) {
        if (includesAny(dayChunk, ['13시', '13:30', '오후 1시', '오후 1시 30분', '13:00'])) {
          dayStartTime = '13:00';
        }
      }
      if (anchorPlace && totalDays === 1) {
        dayEndTime = anchorPlace.targetTime;
      } else if (dayNum === totalDays) {
        if (includesAny(dayChunk, ['20:30', '오후 8시 30분', '8시 30분'])) {
          dayEndTime = '20:30';
        }
      }

      // 일자별 고정 예약 & 필수 방문 장소
      const fixedAppointments: DayTripPreference['fixedAppointments'] = [];
      const mustVisitPlaces: string[] = [];

      if (includesAny(dayChunk, ['리움', '리움미술관'])) {
        fixedAppointments.push({
          name: '리움미술관',
          targetTime: '15:00',
          durationMinutes: 90,
          isMandatory: true,
          category: 'museum',
        });
        mustVisitPlaces.push('리움미술관');
      }
      if (includesAny(dayChunk, ['경복궁'])) {
        mustVisitPlaces.push('경복궁');
      }

      // 일자별 식사 윈도우
      const mealWindows: DayTripPreference['mealWindows'] = [];
      if (includesAny(dayChunk, ['저녁', '디너', '夕食', '한식', '고기'])) {
        mealWindows.push({
          mealType: 'dinner',
          targetTime: '18:30',
          durationMinutes: 90,
          cuisinePreferences: includesAny(dayChunk, ['고기', '갈비', '삼겹살'])
            ? ['meat', 'korean']
            : ['korean'],
          area: dayArea,
        });
      }
      if (includesAny(dayChunk, ['점심', '런치', '昼食'])) {
        mealWindows.push({
          mealType: 'lunch',
          targetTime: '12:30',
          durationMinutes: 60,
          cuisinePreferences: ['korean'],
          area: dayArea,
        });
      }

      // 일자별 관심사
      const dayInterests: string[] = [];
      if (totalDays === 1 && interests.length > 0) {
        dayInterests.push(...interests);
      } else {
        if (includesAny(dayChunk, ['カフェ', 'cafe', '커피', '카페'])) dayInterests.push('cafe');
        if (
          includesAny(dayChunk, [
            '博物館',
            '美術館',
            '文化',
            '미술관',
            '문화',
            '경복궁',
            '전시',
            '한옥',
          ])
        )
          dayInterests.push('culture');
        if (
          includesAny(dayChunk, ['セレクトショップ', '쇼핑', '편집샵', '편집숍', '문구', '브랜드'])
        ) {
          dayInterests.push('select_shop');
          dayInterests.push('shopping');
        }
        if (includesAny(dayChunk, ['焼肉', '고기', '한식', '갈비', '맛집', '음식']))
          dayInterests.push('meat');
        if (dayInterests.length === 0)
          dayInterests.push(...(interests.length > 0 ? interests : ['cafe', 'culture']));
      }

      // 일자별 앵커
      const dayAnchor = fixedAppointments[0]
        ? {
            name: fixedAppointments[0].name,
            targetTime: fixedAppointments[0].targetTime,
            role: 'destination' as const,
          }
        : mustVisitPlaces[0]
          ? {
              name: mustVisitPlaces[0],
              targetTime: dayStartTime === '13:30' ? '14:30' : '11:00',
              role: 'destination' as const,
            }
          : totalDays === 1
            ? anchorPlace
            : null;

      const dailyBudget = totalBudget ? Math.round(totalBudget / totalDays) : null;

      days.push({
        dayNumber: dayNum,
        date: dayDate,
        title: `Day ${dayNum}: ${dayArea} 맞춤 여행`,
        area: dayArea,
        startTime: dayStartTime,
        endTime: dayEndTime,
        dailyBudgetKrw: dailyBudget,
        startAnchor:
          dayNum === 1 && airport
            ? { name: airport, targetTime: dayStartTime, role: 'start' }
            : baseCamp
              ? { name: baseCamp.name, targetTime: dayStartTime, role: 'start' }
              : null,
        endAnchor:
          dayNum === totalDays &&
          airport &&
          (totalDays > 1 || /출국|귀국|공항으로|공항\s*이동/i.test(input.text))
            ? { name: airport, targetTime: dayEndTime, role: 'destination' }
            : baseCamp
              ? { name: baseCamp.name, targetTime: dayEndTime, role: 'destination' }
              : null,
        fixedAppointments,
        mealWindows,
        mustVisitPlaces,
        interests: [...new Set(dayInterests)],
        preferences: includesAny(dayChunk, ['静か', '조용', '한옥', '분위기', '편안'])
          ? ['quiet']
          : [],
        avoid: avoidTags.length > 0 ? avoidTags : ['crowded'],
        maxWalkMinutes: hasWalkingConstraint ? 7 : 15,
        anchorPlace: dayAnchor,
      });
    }

    const firstDay = days[0];

    const preference: ParsedTripPreference = {
      tripTitle:
        days.length > 1 ? `서울 ${totalDays}일 맞춤 여행` : `${extractedArea || '서울'} 하루 여행`,
      startDate,
      endDate,
      totalDays,
      totalBudgetKrw: totalBudget,
      partySize,
      companions:
        partySize > 1 ? 'friends' : includesAny(input.text, ['一人', '혼자']) ? 'solo' : null,
      pace: includesAny(input.text, ['ゆっくり', 'relaxed', '여유', '편하게', '편안'])
        ? 'relaxed'
        : null,
      baseCamp,
      airport,
      mobilityConstraint,
      userPriorities: ['crowd_avoidance', 'must_visit', 'short_transit', 'interest', 'budget'],
      rainFallbackPolicy: 'indoor_switch',

      // Single-day shortcut fields
      area: firstDay?.area ?? extractedArea,
      startTime: firstDay?.startTime ?? '13:00',
      endTime: firstDay?.endTime ?? '21:00',
      budget: totalBudget,
      interests: firstDay?.interests ?? [...new Set(interests)],
      preferences: firstDay?.preferences ?? [],
      avoid: firstDay?.avoid ?? [...new Set(avoidTags)],
      maxWalkMinutes: firstDay?.maxWalkMinutes ?? (hasWalkingConstraint ? 7 : null),
      anchorPlace: firstDay?.anchorPlace ?? anchorPlace,

      // Hierarchical multi-day array
      days,
    };

    return Promise.resolve({
      preference: this.schema.validate(preference),
      parserMode: 'mock',
      warnings: [
        'OpenAI가 아닌 명시적 MOCK 규칙 파서를 사용했습니다. 해석 결과를 실제 AI 결과로 간주하지 마세요.',
      ],
    });
  }
}
