import { Injectable } from '@nestjs/common';
import type {
  ExplanationMode,
  ItineraryExplanationInput,
  ItineraryExplanationProvider,
  ItineraryExplanationResult,
  StopExplanationItem,
} from './itinerary-explanation.types';

function categoryNameJa(cat: string | null): string {
  switch (cat) {
    case 'cafe':
      return 'カフェ';
    case 'restaurant':
      return '飲食店';
    case 'culture':
      return '文化・観光スポット';
    case 'park':
      return '公園・自然スポット';
    case 'shopping':
      return 'ショッピングスポット';
    case 'museum':
      return '美術館・博物館';
    default:
      return 'スポット';
  }
}

function categoryNameKo(cat: string | null): string {
  switch (cat) {
    case 'cafe':
      return '카페';
    case 'restaurant':
      return '음식점';
    case 'culture':
      return '문화·관광 명소';
    case 'park':
      return '공원·자연 명소';
    case 'shopping':
      return '쇼핑 명소';
    case 'museum':
      return '박물관·미술관';
    default:
      return '명소';
  }
}

function areaNameJa(area: string | null | undefined): string {
  if (!area) return 'ソウル';
  switch (area) {
    case '성수':
      return '聖水（ソンス）';
    case '홍대':
      return '弘大（ホンデ）';
    case '서촌':
      return '西村（ソチョン）';
    case '한남':
      return '漢南（ハンナム）';
    case '공덕':
    case '공덕동':
      return '孔徳（コンドク）';
    case '명동':
      return '明洞（ミョンドン）';
    case '강남':
      return '江南（カンナム）';
    case '동대문':
      return '東大門（トンデムン）';
    case '잠실':
      return '蚕室（チャムシル）';
    case '종로':
      return '鍾路（チョンノ）';
    case '이태원':
      return '梨泰院（イテウォン）';
    default:
      return area;
  }
}

function districtNameJa(district: string | null | undefined): string {
  if (!district) return 'ソウル';
  switch (district) {
    case '성동구':
      return 'ソウル城東区';
    case '마포구':
      return 'ソウル麻浦区';
    case '종로구':
      return 'ソウル鍾路区';
    case '용산구':
      return 'ソウル龍山区';
    case '중구':
      return 'ソウル中区';
    case '강남구':
      return 'ソウル江南区';
    case '송파구':
      return 'ソウル松坡区';
    case '서초구':
      return 'ソウル瑞草区';
    case '영등포구':
      return 'ソウル永登浦区';
    case '서대문구':
      return 'ソウル西大門区';
    case '동대문구':
      return 'ソウル東大門区';
    case '성북구':
      return 'ソウル城北区';
    case '광진구':
      return 'ソウル広津区';
    default:
      return district;
  }
}

function interestNameJa(interest: string): string {
  switch (interest.toLowerCase()) {
    case 'cafe':
      return 'カフェ';
    case 'shopping':
      return 'ショッピング';
    case 'culture':
      return '文化・アート';
    case 'park':
      return '公園・散策';
    case 'restaurant':
    case 'food':
      return 'グルメ';
    case 'meat':
      return '焼肉';
    default:
      return interest;
  }
}

function hasHangulBatchim(text: string): boolean {
  const clean = text.replace(/[\s'")\]]+$/gu, '');
  if (clean.length === 0) return false;
  const code = clean.charCodeAt(clean.length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 > 0;
}

function hasHangulRieulBatchim(text: string): boolean {
  const clean = text.replace(/[\s'")\]]+$/gu, '');
  if (clean.length === 0) return false;
  const code = clean.charCodeAt(clean.length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8;
}

function attachTopicParticle(word: string): string {
  return hasHangulBatchim(word) ? `${word}은` : `${word}는`;
}

function attachDirectionParticle(word: string): string {
  if (hasHangulRieulBatchim(word)) return `${word}로`;
  return hasHangulBatchim(word) ? `${word}으로` : `${word}로`;
}

@Injectable()
export class DeterministicItineraryExplanationProvider implements ItineraryExplanationProvider {
  generate(
    input: ItineraryExplanationInput,
    mode: ExplanationMode = 'mock',
  ): Promise<ItineraryExplanationResult> {
    const { locale, preference, stops } = input;
    const isJa = locale === 'ja';
    const totalDays = preference.totalDays ?? (preference.startDate && preference.endDate ? 1 : 1);
    const area = preference.area;
    const interests = preference.interests ?? [];

    let tripSummary: string;
    if (isJa) {
      const areaJa = areaNameJa(area);
      const areaPrefix = area ? `${areaJa}エリアを中心とした` : 'ソウル';
      const daysText = totalDays > 1 ? `${totalDays}日間の` : '';
      const interestJaList = interests.map(interestNameJa);
      const interestText = interestJaList.length > 0 ? `${interestJaList.join('・')}を中心に` : '';
      tripSummary = `${areaPrefix}${daysText}旅行日程です。${interestText}選定された${stops.length}か所を巡るルートです。`;
    } else {
      const areaPrefix = area ? `${area} 지역 중심의 ` : '서울 ';
      const daysText = totalDays > 1 ? `${totalDays}일 ` : '';
      const interestText = interests.length > 0 ? `${interests.join(', ')} 관심사를 바탕으로 ` : '';
      tripSummary = `${areaPrefix}${daysText}여행 일정입니다. ${interestText}선정된 ${stops.length}곳을 방문하는 코스입니다.`;
    }

    const explainedStops: StopExplanationItem[] = stops.map((stop, index) => {
      const prevStop = index > 0 ? stops[index - 1] : undefined;
      const nextStop = index < stops.length - 1 ? stops[index + 1] : undefined;

      // Day boundary check
      const isSameDayWithPrev = prevStop && prevStop.dayNumber === stop.dayNumber;
      const isSameDayWithNext = nextStop && nextStop.dayNumber === stop.dayNumber;

      // 1. shortDescription
      let shortDescription: string;
      if (stop.verifiedDescription) {
        shortDescription = stop.verifiedDescription;
      } else if (isJa) {
        const catJa = categoryNameJa(stop.category);
        const loc = districtNameJa(stop.district) ?? areaNameJa(area) ?? 'ソウル';
        shortDescription = `${stop.placeName}は${loc}に位置する${catJa}です。`;
      } else {
        const catKo = categoryNameKo(stop.category);
        const loc = stop.district ?? area ?? '서울';
        shortDescription = `${attachTopicParticle(stop.placeName)} ${loc}에 위치한 ${catKo}입니다.`;
      }

      // 2. previousStopFit
      let previousStopFit: string | null = null;
      if (isSameDayWithPrev && prevStop) {
        const duration = stop.inboundRoute?.durationMinutes;
        if (isJa) {
          previousStopFit = duration
            ? `前スポット「${prevStop.placeName}」から移動時間約${duration}分（推定）で移動できる動線です。`
            : `前スポット「${prevStop.placeName}」の後に続いて訪問する動線です。`;
        } else {
          previousStopFit = duration
            ? `이전 장소 '${prevStop.placeName}'에서 이동 시간 약 ${duration}분(추정) 거리입니다.`
            : `이전 장소 '${prevStop.placeName}' 다음에 방문하도록 연결된 동선입니다.`;
        }
      }

      // 3. nextStopFit
      let nextStopFit: string | null = null;
      if (isSameDayWithNext && nextStop) {
        const duration =
          stop.nextLegRoute?.durationMinutes ?? nextStop.inboundRoute?.durationMinutes;
        if (isJa) {
          nextStopFit = duration
            ? `次スポット「${nextStop.placeName}」へ移動時間約${duration}分（推定）で移動できる動線です。`
            : `次スポット「${nextStop.placeName}」へ続く動線です。`;
        } else {
          const target = `다음 장소인 '${nextStop.placeName}'`;
          nextStopFit = duration
            ? `${attachDirectionParticle(target)} 이동 시간 약 ${duration}분(추정) 거리입니다.`
            : `${attachDirectionParticle(target)} 이어지는 동선입니다.`;
        }
      }

      // 4. overallTripFit
      let overallTripFit: string;
      if (stop.reason && stop.reason.trim().length > 0) {
        overallTripFit = stop.reason;
      } else if (isJa) {
        const interestJaList = interests.map(interestNameJa);
        overallTripFit =
          interestJaList.length > 0
            ? `${interestJaList.join('・')}の希望に合致し、日程全体の動線に適合しています。`
            : '旅程全体の時間と動線バランスに適合しています。';
      } else {
        overallTripFit =
          interests.length > 0
            ? `${interests.join(', ')} 취향에 부합하며 전체 일정 동선에 적합합니다.`
            : '전체 일정의 시간과 동선 균형에 적합합니다.';
      }

      return {
        order: stop.order,
        placeId: stop.placeId,
        shortDescription,
        previousStopFit,
        nextStopFit,
        overallTripFit,
      };
    });

    return Promise.resolve({
      tripSummary,
      locale,
      stops: explainedStops,
      mode,
      model: null,
      generatedAt: new Date().toISOString(),
    });
  }
}
