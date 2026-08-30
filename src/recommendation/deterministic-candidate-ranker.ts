import { Injectable } from '@nestjs/common';
import { isNorthKoreaRelated } from '../common/utils/security-filter.util';
import { coordinatesOf, haversineDistanceKm, type Coordinates } from './geo';
import type {
  CandidatePlace,
  CandidateRanker,
  OpeningInterval,
  RankCandidatesInput,
  RankCandidatesResult,
  RankedCandidate,
  ScoreBreakdown,
  ScoreWeights,
  TourismScoreWeights,
} from './ports';
import { FRANCHISE_PATTERNS } from './brand-extractor';

export const DEFAULT_SCORE_WEIGHTS: Readonly<
  ScoreWeights & { localImpact: number; tourismDispersion: number }
> = Object.freeze({
  preference: 0.3,
  crowd: 0.15,
  distance: 0.15,
  time: 0.1,
  budget: 0.1,
  diversity: 0.05,
  area: 0,
  tourismDispersion: 0,
  localImpact: 0.15,
});

const CATEGORY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  cafe: ['cafe'],
  select_shop: ['shopping'],
  shopping: ['shopping'],
  meat: ['restaurant'],
  food: ['restaurant'],
  restaurant: ['restaurant'],
  park: ['park'],
  culture: ['culture'],
  night_view: ['park', 'culture', 'attraction'],
  photography: ['park', 'culture', 'attraction'],
  photo: ['park', 'culture', 'attraction'],
  landmark: ['culture', 'attraction', 'park'],
  attraction: ['attraction', 'culture', 'park'],
  sightseeing: ['culture', 'attraction', 'park'],
  leisure: ['leisure', 'park'],
};

const CATEGORY_LABELS: Readonly<Record<string, readonly [string, string]>> = {
  cafe: ['카페', 'カフェ'],
  shopping: ['쇼핑', 'ショッピング'],
  select_shop: ['편집숍', 'セレクトショップ'],
  meat: ['고기 요리', '肉料理'],
  food: ['음식', 'グルメ'],
  restaurant: ['음식점', '飲食店'],
  culture: ['문화시설', '文化施設'],
  park: ['공원', '公園'],
  leisure: ['레저', 'レジャー'],
  attraction: ['관광명소', '観光スポット'],
};

function categoryLabel(value: string, isKo: boolean): string {
  const labels = CATEGORY_LABELS[normalizeTag(value)];
  return labels?.[isKo ? 0 : 1] ?? value;
}

export function isNonTouristFacility(place: CandidatePlace): boolean {
  if (place.category === 'medical' || place.category === 'lodging') return true;
  const target = `${place.name} ${place.category ?? ''} ${place.rawCategory ?? ''}`.toLowerCase();
  return (
    /a020205/.test(target) ||
    /클리닉|クリニック|clinic|성형외과|피부과|치과|안과|한의원|병원|의원|비뇨기|산부인과|정형외과|내과|외과|이비인후과|도수치료|마사지|약국|pharmacy/i.test(
      target,
    )
  );
}

export function isFranchisePlace(place: CandidatePlace): boolean {
  const name = place.name.normalize('NFKC');
  const rawCat = place.rawCategory?.normalize('NFKC') ?? '';
  return FRANCHISE_PATTERNS.some((pattern) => pattern.test(name) || pattern.test(rawCat));
}

export function isAlleywayMarket(place: CandidatePlace): boolean {
  const address = `${place.roadAddress ?? ''} ${place.address ?? ''}`.normalize('NFKC');
  const name = place.name.normalize('NFKC');
  return /길\b|골목|길\s*\d+|시장|상가/u.test(address) || /골목|시장|공방|화방|상회/u.test(name);
}

export function localImpactScore(place: CandidatePlace): number {
  if (place.isAnchor) return 1.0;
  if (isFranchisePlace(place)) return 0.2;
  if (place.category === 'culture' || place.category === 'park') return 0.75;

  let base = 0.9;
  if (isAlleywayMarket(place)) {
    base += 0.1;
  }
  return clamp(base);
}

function clamp(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function rounded(value: number): number {
  return Number(clamp(value).toFixed(6));
}

function normalizeTag(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normalizedWeights(weights: TourismScoreWeights): TourismScoreWeights {
  const total = (Object.values(weights) as Array<number | undefined>).reduce(
    (sum: number, value: number | undefined) => sum + (value ?? 0),
    0,
  );
  if (total === 0) return { ...DEFAULT_SCORE_WEIGHTS };
  const normalized: TourismScoreWeights = { ...weights };
  for (const key of Object.keys(normalized) as Array<keyof TourismScoreWeights>) {
    const value = normalized[key];
    if (typeof value === 'number') {
      normalized[key] = value / total;
    }
  }
  return normalized;
}

export function dynamicScoreWeights(input: RankCandidatesInput): TourismScoreWeights {
  const weights: TourismScoreWeights = { ...DEFAULT_SCORE_WEIGHTS };
  const preferences = input.preference.preferences.map(normalizeTag);
  const avoid = input.preference.avoid.map(normalizeTag);

  if (avoid.some((a) => /very[-_]?crowded|人混み|混雑/.test(a) && /very|本当に|매우/.test(a))) {
    weights.crowd = 0.35;
    weights.distance = 0.1;
  } else if (avoid.some((a) => /crowd|混雑|붐빔/.test(a))) {
    weights.crowd = 0.25;
    weights.distance = 0.1;
  }

  const hasWalkingConstraint =
    avoid.some((tag) => /long_walk|walk|歩|걷|도보/.test(tag.toLowerCase())) ||
    (input.preference.maxWalkMinutes !== null &&
      input.preference.maxWalkMinutes !== undefined &&
      input.preference.maxWalkMinutes <= 10) ||
    preferences.includes('short_distance');

  if (hasWalkingConstraint) {
    weights.distance = 0.35;
    weights.crowd = 0.1;
  }

  if (preferences.includes('low_cost')) {
    weights.budget = 0.2;
    weights.preference = 0.25;
  }

  if (preferences.includes('local')) {
    weights.localImpact = 0.25;
  }

  const hasTourismDispersion = input.places.some(
    (place) =>
      place.tourism?.concentration.dispersion !== undefined &&
      place.tourism.concentration.dispersion !== null,
  );
  if (hasTourismDispersion) {
    weights.tourismDispersion = 0.15;
  }

  return normalizedWeights(weights);
}

function categoryMatches(category: string | null, interests: string[]): boolean {
  if (!category) return false;
  return interests.some((interest) =>
    (CATEGORY_ALIASES[normalizeTag(interest)] ?? [normalizeTag(interest)]).includes(category),
  );
}

function preferenceScore(place: CandidatePlace, input: RankCandidatesInput): number {
  if (input.preference.interests.length === 0 && input.preference.preferences.length === 0) {
    return 0.5;
  }

  // 1. Category alignment (0.2 to 0.7)
  let categoryPart = 0.2;
  if (place.category && categoryMatches(place.category, input.preference.interests)) {
    categoryPart = 0.7;
  } else if (input.preference.interests.length === 0) {
    categoryPart = 0.5;
  }

  // 2. Semantic Mood & Preference Keywords (0.0 to 0.3)
  const placeContext =
    `${place.name} ${place.rawCategory ?? ''} ${place.address ?? ''} ${place.roadAddress ?? ''}`.toLowerCase();
  const userPrefs = [...input.preference.preferences, ...input.preference.interests].map((p) =>
    p.toLowerCase(),
  );
  const rawText = (input.preference as unknown as { originalText?: string }).originalText ?? '';
  const userText = rawText.toLowerCase();

  let moodBonus = 0;

  // Quiet / Relaxed / Calm
  if (
    userPrefs.some((p) => /quiet|calm|relaxed|조용|차분|한적|힐링|여유/.test(p)) ||
    /조용|차분|한적|힐링/.test(userText)
  ) {
    if (/찻집|갤러리|한옥|정원|공원|북카페|책방|도서관|산책/.test(placeContext)) {
      moodBonus += 0.15;
    }
    if (/클럽|주점|시끌|웨이팅|포차|나이트/.test(placeContext)) {
      moodBonus -= 0.15;
    }
  }

  // Traditional / Heritage / Hanok
  if (
    userPrefs.some((p) => /traditional|heritage|culture|전통|한옥|역사|궁/.test(p)) ||
    /전통|한옥|궁궐|고궁|역사|인사동|서촌|북촌/.test(userText)
  ) {
    if (/전통|한옥|궁|민속|한식|고택|사찰|유적|박물관|미술관/.test(placeContext)) {
      moodBonus += 0.2;
    }
  }

  // Hip / Trendy / Aesthetic / Boutique / Popup
  if (
    userPrefs.some((p) => /trendy|hip|aesthetic|감성|힙한|팝업|소품/.test(p)) ||
    /감성|힙한|팝업|소품|편집/.test(userText)
  ) {
    if (/편집|소품|팝업|디저트|베이커리|스튜디오|로스터리|갤러리|공방|쇼룸/.test(placeContext)) {
      moodBonus += 0.15;
    }
  }

  // Meat / Gourmet
  if (
    userPrefs.some((p) => /meat|food|gourmet|삼겹살|고기|맛집|미식/.test(p)) ||
    /삼겹살|고기|갈비|바베큐|구이|맛집/.test(userText)
  ) {
    if (/육류|고기|삼겹살|갈비|한우|바베큐|돼지|소고기|곱창/.test(placeContext)) {
      moodBonus += 0.2;
    }
  }

  // Direct specific term hit in place name
  if (userText.length > 0) {
    const tokens = userText.split(/\s+/).filter((t: string) => t.length >= 2);
    for (const token of tokens) {
      if (place.name.toLowerCase().includes(token)) {
        moodBonus += 0.1;
        break;
      }
    }
  }

  const preferenceTotal = categoryPart + clamp(moodBonus);
  return clamp(preferenceTotal);
}

function crowdScore(input: RankCandidatesInput): number {
  if (!input.crowd?.congestionLevel) return 0.5;
  const level = input.crowd.congestionLevel.normalize('NFKC').toLowerCase();
  if (/여유|relaxed|quiet|閑散|낮음|low/.test(level)) return 1.0;
  if (/보통|normal|普通|약간|slightly|やや/.test(level)) return 0.65;
  if (/붐빔|crowded|混雑|혼잡|높음|high/.test(level)) return 0.15;
  return 0.5;
}

function clusterCenter(places: CandidatePlace[]): Coordinates | null {
  const points = places
    .map((place) => coordinatesOf(place.location))
    .filter((point): point is Coordinates => point !== null);
  if (points.length === 0) return null;
  return {
    longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
    latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
  };
}

function distanceScore(place: CandidatePlace, center: Coordinates | null): number {
  const point = coordinatesOf(place.location);
  if (!point || !center) return 0.5;
  const distance = haversineDistanceKm(point, center);
  return 1 / (1 + distance / 1.5);
}

function minutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match?.[1] && match[2] ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function intervalOverlapMinutes(
  interval: OpeningInterval,
  requestedStart: string,
  requestedEnd: string,
): number {
  const opens = minutes(interval.opensAt);
  const closes = minutes(interval.closesAt);
  const start = minutes(requestedStart);
  const end = minutes(requestedEnd);
  if (opens === null || closes === null || start === null || end === null || closes <= opens) {
    return 0;
  }
  return Math.max(0, Math.min(closes, end) - Math.max(opens, start));
}

function timeScore(place: CandidatePlace, input: RankCandidatesInput): number {
  if (!place.openingHours || place.openingHours.length === 0) return 0.5;
  const overlap = Math.max(
    ...place.openingHours.map((interval) =>
      intervalOverlapMinutes(interval, input.preference.startTime, input.preference.endTime),
    ),
  );
  if (overlap >= (place.estimatedStayMinutes ?? defaultStayMinutes(place.category))) return 1;
  return overlap > 0 ? 0.4 : 0;
}

function budgetScore(place: CandidatePlace, budget: number | null): number {
  const cost = place.estimatedCostKrw;
  if (budget === null || cost === null || cost === undefined) return 0.5;
  if (budget === 0) return cost === 0 ? 1 : 0;
  if (cost > budget) return 0;
  return 0.5 + 0.5 * (1 - cost / budget);
}

function areaScore(place: CandidatePlace, area: string | null): number {
  if (!area) return 0.5;
  const address = `${place.address ?? ''} ${place.roadAddress ?? ''}`.normalize('NFKC');
  return address.includes(area.normalize('NFKC')) ? 1 : 0.2;
}

function diversityScore(
  place: CandidatePlace,
  categoryCounts: ReadonlyMap<string, number>,
): number {
  if (!place.category) return 0.5;
  const count = categoryCounts.get(place.category) ?? 1;
  return 0.5 + 0.5 / count;
}

function defaultStayMinutes(category: string | null): number {
  if (category === 'park' || category === 'culture' || category === 'restaurant') return 75;
  if (category === 'shopping') return 50;
  return 60;
}

function warnings(input: RankCandidatesInput): string[] {
  const values: string[] = [];
  const noCost = input.places.filter(
    (place) => place.estimatedCostKrw === null || place.estimatedCostKrw === undefined,
  ).length;
  const noHours = input.places.filter(
    (place) => !place.openingHours || place.openingHours.length === 0,
  ).length;
  const noLocation = input.places.filter((place) => !coordinatesOf(place.location)).length;
  if (noCost > 0) {
    values.push(`${noCost}개 장소의 가격 정보가 없어 예산 점수에 중립값을 사용했습니다.`);
  }
  if (noHours > 0) {
    values.push(`${noHours}개 장소의 영업시간 정보가 없어 시간 점수에 중립값을 사용했습니다.`);
  }
  if (noLocation > 0) {
    values.push(`${noLocation}개 장소의 검증된 좌표가 없어 경로 후보에서 제외될 수 있습니다.`);
  }
  if (!input.crowd?.congestionLevel) {
    values.push('사용 가능한 지역 혼잡 관측값이 없어 혼잡 점수에 중립값을 사용했습니다.');
  } else {
    values.push('혼잡 점수는 장소 내부가 아닌 지역 단위 혼잡 관측값을 사용했습니다.');
  }
  return values;
}

@Injectable()
export class DeterministicCandidateRanker implements CandidateRanker {
  rank(input: RankCandidatesInput): RankCandidatesResult {
    const validPlaces = input.places.filter(
      (p) =>
        !isNorthKoreaRelated(p.name) &&
        !isNorthKoreaRelated(p.category) &&
        !isNorthKoreaRelated(p.rawCategory) &&
        !isNorthKoreaRelated(p.address) &&
        !isNorthKoreaRelated(p.roadAddress) &&
        !isNonTouristFacility(p),
    );
    const weights = dynamicScoreWeights(input);
    const center = clusterCenter(validPlaces);
    const categoryCounts = new Map<string, number>();
    for (const place of validPlaces) {
      if (place.category) {
        categoryCounts.set(place.category, (categoryCounts.get(place.category) ?? 0) + 1);
      }
    }

    const candidates = validPlaces.map((place): RankedCandidate => {
      const components: ScoreBreakdown = {
        total: 0,
        preference: rounded(preferenceScore(place, input)),
        crowd: rounded(crowdScore(input)),
        distance: rounded(distanceScore(place, center)),
        time: rounded(timeScore(place, input)),
        budget: rounded(budgetScore(place, input.preference.budget)),
        diversity: rounded(diversityScore(place, categoryCounts)),
        area: rounded(areaScore(place, input.preference.area)),
        localImpact: rounded(localImpactScore(place)),
      };

      if (
        place.tourism?.concentration.dispersion !== undefined &&
        place.tourism.concentration.dispersion !== null
      ) {
        components.tourismDispersion = rounded(place.tourism.concentration.dispersion);
      }

      // Dynamic Weight Renormalization: sum only available components and divide by their weight sum
      let availableWeightSum = 0;
      let weightedScoreSum = 0;

      for (const key of Object.keys(weights) as Array<keyof TourismScoreWeights>) {
        const compVal = components[key];
        const weightVal = weights[key];
        if (typeof compVal === 'number' && typeof weightVal === 'number' && weightVal > 0) {
          weightedScoreSum += compVal * weightVal;
          availableWeightSum += weightVal;
        }
      }

      const total = availableWeightSum > 0 ? weightedScoreSum / availableWeightSum : 0.5;
      components.total = rounded(total);

      if (place.isAnchor) {
        components.preference = 1;
        components.total = 1;
      }

      return {
        place,
        estimatedCost: place.estimatedCostKrw ?? null,
        priceEvidence: place.priceEvidence ?? null,
        estimatedStayMinutes:
          place.estimatedStayMinutes ?? (place.isAnchor ? 30 : defaultStayMinutes(place.category)),
        reason: this.reason(input, place, components),
        scoreBreakdown: components,
        isAnchor: place.isAnchor,
      };
    });
    candidates.sort(
      (a, b) =>
        b.scoreBreakdown.total - a.scoreBreakdown.total ||
        a.place.source.localeCompare(b.place.source) ||
        a.place.sourcePlaceId.localeCompare(b.place.sourcePlaceId),
    );
    return {
      algorithmVersion: 'deterministic-v2',
      weights,
      candidates,
      warnings: warnings(input),
    };
  }

  private reason(input: RankCandidatesInput, place: CandidatePlace, score: ScoreBreakdown): string {
    const isKo = input.locale === 'ko';
    if (place.isAnchor) {
      const time = place.targetTime ? ` ${place.targetTime}` : '';
      if (place.fixedAppointment) {
        return isKo
          ? `${place.name}은 사용자가${time}에 반드시 방문하도록 지정한 고정 일정입니다. 추천 점수 경쟁으로 선택된 장소가 아니라 시간 제약을 우선해 일정에 포함했습니다.`
          : `${place.name}は、ユーザーが${time}に必ず訪れるよう指定した固定予定です。推薦スコアの競争ではなく、時間制約を優先して旅程に含めました。`;
      }
      return isKo
        ? `${place.name}은 사용자가 직접 지정한 필수 방문 장소입니다. 추천 점수 경쟁으로 선택된 장소가 아니라 사용자의 명시적 요청을 우선해 일정에 포함했습니다.`
        : `${place.name}は、ユーザーが直接指定した必須訪問スポットです。推薦スコアの競争ではなく、明示された希望を優先して旅程に含めました。`;
    }

    const reasons: string[] = [];
    const matchingInterests = input.preference.interests.filter((interest) =>
      (CATEGORY_ALIASES[normalizeTag(interest)] ?? [normalizeTag(interest)]).includes(
        place.category ?? '',
      ),
    );
    if (matchingInterests.length > 0) {
      const interestLabels = matchingInterests
        .map((interest) => categoryLabel(interest, isKo))
        .join(isKo ? ', ' : '・');
      const placeCategory = categoryLabel(place.category ?? '', isKo);
      reasons.push(
        isKo
          ? `요청한 관심사(${interestLabels})와 장소 분류(${placeCategory})가 일치해 취향 적합도 ${Math.round(score.preference * 100)}%를 받았습니다`
          : `希望した関心分野（${interestLabels}）とスポット分類（${placeCategory}）が一致し、好み適合度は${Math.round(score.preference * 100)}%です`,
      );
    }
    const hasWalkingConstraint =
      input.preference.avoid.some((tag) => /long_walk|walk|歩|걷|도보/.test(tag.toLowerCase())) ||
      (input.preference.maxWalkMinutes !== null &&
        input.preference.maxWalkMinutes !== undefined &&
        input.preference.maxWalkMinutes <= 10);
    if (hasWalkingConstraint) {
      reasons.push(
        isKo
          ? `도보 부담 조건을 반영했고 이동 거리 점수는 ${Math.round(score.distance * 100)}%입니다`
          : `徒歩負担の条件を反映し、移動距離スコアは${Math.round(score.distance * 100)}%です`,
      );
    }
    if (input.crowd?.congestionLevel) {
      reasons.push(
        isKo
          ? `${input.crowd.areaName} 지역 혼잡 정보를 참고했습니다 (장소 내부 혼잡도가 아닙니다)`
          : `${input.crowd.areaName}エリアの混雑情報を参考にしました（店内混雑度ではありません）`,
      );
    }
    if (score.localImpact && score.localImpact >= 0.8) {
      reasons.push(
        isKo
          ? `로컬 발견 휴리스틱은 ${Math.round(score.localImpact * 100)}%이지만 공식 독립매장 인증이 아닙니다`
          : `ローカル発見ヒューリスティックは${Math.round(score.localImpact * 100)}%ですが公式な独立店舗認証ではありません`,
      );
    }
    if (score.tourismDispersion && score.tourismDispersion >= 0.6) {
      reasons.push(
        isKo
          ? `한국관광 데이터랩 관광객 집중 분산 지표(${Math.round(score.tourismDispersion * 100)}%)를 반영했습니다`
          : `韓国観光データラボの混雑分散指標（${Math.round(score.tourismDispersion * 100)}%）を反映しました`,
      );
    }

    const totalLabel = isKo
      ? `최종 추천 점수는 ${Math.round(score.total * 100)}%입니다.`
      : `最終推薦スコアは${Math.round(score.total * 100)}%です。`;

    return reasons.length > 0
      ? reasons.join(isKo ? '. ' : '。 ') + (isKo ? '. ' : '。') + totalLabel
      : totalLabel;
  }
}
