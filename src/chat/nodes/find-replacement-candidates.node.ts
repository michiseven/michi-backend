import type { Repository } from 'typeorm';
import type { Place, Trip } from '../../database/entities';
import type {
  ChatState,
  ChatUpdate,
  PendingTripMutation,
  ReplacementCandidate,
} from '../chat-state';
import { verifiedPlacePrice } from '../../providers/place/place-price-evidence';
import { isNorthKoreaRelated } from '../../common/utils/security-filter.util';
import { extractExplicitSeoulArea } from '../chat-intent';
import {
  knownSeoulSearchArea,
  seoulDistrictForArea,
} from '../../providers/place/seoul-area-centers';
import { resolveVerifiedPlaceCategory } from '../../providers/place/place-normalizer';
import {
  hasTraditionalTeaEvidence,
  requestsTraditionalTea,
} from '../../preferences/traditional-tea';

type ReplacementCategory = 'cafe' | 'restaurant' | 'shopping' | 'culture' | 'attraction';

function requestedCategory(text: string, fallback?: string | null): ReplacementCategory | null {
  const value = `${text} ${fallback ?? ''}`.normalize('NFKC').toLowerCase();
  if (requestsTraditionalTea(text)) return 'cafe';
  // A requested destination category outranks the name/category of the old stop.
  if (/(?:식당|맛집|레스토랑|restaurant|食堂|レストラン)(?:[으]?로|に)/u.test(value)) {
    return 'restaurant';
  }
  if (/카페|커피|디저트|베이커리|cafe|coffee|カフェ|喫茶/.test(value)) return 'cafe';
  if (/식당|맛집|고기|곱창|레스토랑|restaurant|グルメ|食堂|焼肉/.test(value)) {
    return 'restaurant';
  }
  if (/편집숍|소품|쇼핑|상점|shop|shopping|ショップ|買い物/.test(value)) return 'shopping';
  if (/미술관|박물관|갤러리|문화|museum|gallery|美術館|博物館/.test(value)) {
    return 'culture';
  }
  if (/관광|명소|공원|attraction|観光|公園/.test(value)) return 'attraction';
  return null;
}

function matchesCategory(place: Place, category: ReplacementCategory | null): boolean {
  if (!category) return true;
  const verified = resolveVerifiedPlaceCategory(place);
  return verified === category || (category === 'attraction' && verified === 'park');
}

function distanceMeters(left?: Place['location'], right?: Place['location']): number | undefined {
  if (!left || !right) return undefined;
  const [lon1, lat1] = left.coordinates;
  const [lon2, lat2] = right.coordinates;
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return undefined;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function createFindReplacementCandidatesNode(
  placesRepo: Repository<Place>,
  tripsRepo: Repository<Trip>,
) {
  return async (state: ChatState): Promise<ChatUpdate> => {
    // If target stop is unresolved or error occurred
    if (state.errorCode || !state.modification?.targetStopId || !state.currentTripId) {
      return {};
    }

    const isKo = state.locale === 'ko';
    const trip = await tripsRepo.findOne({
      where: { id: state.currentTripId },
      relations: ['stops', 'stops.place', 'preference'],
    });

    if (!trip) {
      return {
        responseMessage: isKo ? '일정을 찾을 수 없습니다.' : 'プランが見つかりませんでした。',
        status: 'failed',
        errorCode: 'TRIP_NOT_FOUND',
      };
    }

    const targetStop = trip.stops?.find((s) => s.id === state.modification?.targetStopId);
    if (!targetStop) {
      return {
        responseMessage: isKo
          ? '수정 대상 장소를 찾지 못했습니다.'
          : '対象スポットが見つかりませんでした。',
        status: 'failed',
        errorCode: 'STOP_NOT_FOUND',
      };
    }

    const stopName = targetStop.place?.name || '장소';
    const targetPlace = targetStop.place;
    const action = state.modification.action;

    if (action === 'remove') {
      const pendingAction: PendingTripMutation = {
        type: 'trip_mutation_confirmation',
        action: 'remove',
        tripId: trip.id,
        targetStop: {
          stopId: targetStop.id,
          placeId: targetStop.placeId,
          placeName: stopName,
        },
        alternatives: [],
        warnings: [
          isKo
            ? `'${stopName}' 장소를 삭제하면 이동 동선 및 방문 시간이 자동으로 재계산됩니다.`
            : `「${stopName}」を削除すると移動ルートと滞在時間が自動で再計算されます。`,
        ],
      };

      const initialPrompt = isKo
        ? `🗑️ **'${stopName}'** 장소를 일정에서 삭제하시겠습니까?\n삭제를 승인하시면 이동 경로와 소요 시간이 자동으로 재조정됩니다.`
        : `🗑️ **「${stopName}」**を旅程から削除しますか？\n削除を承認すると、移動ルートと所要時間が自動で再調整されます。`;

      return {
        pendingAction,
        alternatives: [],
        status: 'awaiting_confirmation',
        responseMessage: initialPrompt,
      };
    }

    // Action: replace -> find up to 3 high quality alternatives
    const currentPlaceIds = new Set((trip.stops || []).map((s) => s.placeId));
    const targetCategory = targetPlace ? resolveVerifiedPlaceCategory(targetPlace) : null;
    const repQuery = state.modification.replacementQuery?.trim();
    const lastMessage = state.messages[state.messages.length - 1];
    const requestText =
      repQuery || (typeof lastMessage?.content === 'string' ? lastMessage.content : '');
    const teaRequired =
      requestsTraditionalTea(requestText) ||
      (targetCategory === 'cafe' && requestsTraditionalTea(trip.preference?.originalText ?? ''));
    const category = requestedCategory(requestText) ?? requestedCategory('', targetCategory);
    const requestedArea = extractExplicitSeoulArea(requestText);
    const station = /홍대입구역|弘大入口駅/u.test(requestText) ? '홍대입구역' : requestedArea;
    const requestedCenter = station ? knownSeoulSearchArea(station) : null;
    const targetDistrict = requestedArea
      ? seoulDistrictForArea(requestedArea)
      : targetPlace?.district || trip.preference?.area;
    const walkLimit = requestText.match(/(?:도보|徒歩|walk(?:ing)?)\s*(\d{1,2})\s*(?:분|分|min)/iu);
    const radiusMeters = walkLimit ? Number(walkLimit[1]) * 70 : requestedCenter?.radiusMeters;
    const centerLocation: Place['location'] = requestedCenter
      ? {
          type: 'Point' as const,
          coordinates: [requestedCenter.longitude, requestedCenter.latitude],
        }
      : targetPlace?.location;
    if (!targetDistrict || (requestedArea && !requestedCenter)) {
      return {
        responseMessage: isKo
          ? '요청 지역의 위치를 검증할 수 없어 대체 장소를 제안하지 않았습니다. 정확한 지역을 알려 주세요.'
          : '指定エリアの位置を確認できないため代替スポットを提案できません。エリアを確認してください。',
        status: 'failed',
        errorCode: 'REPLACEMENT_AREA_UNVERIFIED',
      };
    }

    const qb = placesRepo.createQueryBuilder('p');

    if (currentPlaceIds.size > 0) {
      qb.where('p.id NOT IN (:...excludeIds)', {
        excludeIds: Array.from(currentPlaceIds),
      });
    }

    // Filter non-tourist facilities (clinics, hospitals, offices, accommodation)
    qb.andWhere(
      "NOT (p.name ILIKE '%클리닉%' OR p.name ILIKE '%성형외과%' OR p.name ILIKE '%피부과%' OR p.name ILIKE '%의원%' OR p.name ILIKE '%병원%' OR p.name ILIKE '%치과%' OR p.name ILIKE '%clinic%' OR p.category ILIKE '%medical%' OR p.category ILIKE '%병원%' OR p.category ILIKE '%의원%' OR p.category ILIKE '%호텔%' OR p.category ILIKE '%모텔%' OR p.category ILIKE '%숙박%')",
    );

    // Filter DMZ / North Korea
    qb.andWhere(
      "NOT (p.name ILIKE '%DMZ%' OR p.name ILIKE '%판문점%' OR p.name ILIKE '%통일전망대%' OR p.name ILIKE '%도라산%' OR p.name ILIKE '%임진각%' OR p.name ILIKE '%탈북%' OR (p.name ILIKE '%북한%' AND p.name NOT ILIKE '%북한산%'))",
    );

    qb.andWhere('p.district = :dist', { dist: targetDistrict });
    if ((requestedArea || walkLimit) && centerLocation && radiusMeters != null) {
      qb.andWhere(
        'ST_DWithin(p.location, ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography, :radiusMeters)',
        {
          longitude: centerLocation.coordinates[0],
          latitude: centerLocation.coordinates[1],
          radiusMeters,
        },
      );
    }

    let candidates = await qb.take(200).getMany();

    candidates = candidates.filter(
      (p) =>
        !isNorthKoreaRelated(p.name) &&
        !isNorthKoreaRelated(p.category) &&
        !isNorthKoreaRelated(p.address) &&
        matchesCategory(p, category) &&
        (!teaRequired || hasTraditionalTeaEvidence(p)) &&
        (!(requestedArea || walkLimit) ||
          (distanceMeters(centerLocation, p.location) != null &&
            distanceMeters(centerLocation, p.location)! <= (radiusMeters ?? 0))),
    );

    if (candidates.length === 0) {
      return {
        responseMessage: isKo
          ? '요청한 조건의 근거를 확인할 수 있는 대체 장소를 찾지 못했습니다. 요청 조건은 유지됩니다.'
          : '指定条件の根拠を確認できる代替スポットが見つかりませんでした。元の条件は維持されています。',
        status: 'failed',
        errorCode: 'NO_REPLACEMENT_CANDIDATES',
      };
    }

    candidates.sort((left, right) => {
      const leftDistance = distanceMeters(centerLocation, left.location);
      const rightDistance = distanceMeters(centerLocation, right.location);
      if (leftDistance == null && rightDistance == null) return left.name.localeCompare(right.name);
      if (leftDistance == null) return 1;
      if (rightDistance == null) return -1;
      return leftDistance - rightDistance || left.name.localeCompare(right.name);
    });

    const alternatives: ReplacementCandidate[] = candidates.slice(0, 3).map((p) => {
      const priceInfo = verifiedPlacePrice(p.estimatedCostKrw, p.priceEvidence);
      const measuredDistance = distanceMeters(centerLocation, p.location);
      const distanceText = measuredDistance != null ? `${measuredDistance}m` : '';

      return {
        placeId: p.id,
        name: p.name,
        category: resolveVerifiedPlaceCategory(p) || 'unknown',
        distanceMeters: measuredDistance,
        reason: isKo
          ? `요청 업종과 지역 조건으로 걸렀습니다. ${requestedArea || '기존 장소'} 기준 직선거리 ${distanceText}이며 실제 도보 경로와 조용한 분위기는 미확인입니다.`
          : `指定カテゴリとエリアの条件で絞り込みました。${requestedArea || '元のスポット'}からの直線距離は${distanceText}です。実際の徒歩ルートと静かな雰囲気は未確認です。`,
        evidenceStatus: priceInfo ? 'verified' : 'unverified',
        estimatedCost: priceInfo?.estimatedCostKrw ?? null,
        address: p.roadAddress || p.address || null,
      };
    });

    const pendingAction: PendingTripMutation = {
      type: 'trip_mutation_confirmation',
      action: 'replace',
      tripId: trip.id,
      targetStop: {
        stopId: targetStop.id,
        placeId: targetStop.placeId,
        placeName: stopName,
      },
      alternatives,
      warnings: [
        ...(walkLimit
          ? [
              isKo
                ? `도보 ${walkLimit[1]}분 조건은 직선거리 ${radiusMeters}m 이내로 후보를 제한했을 뿐 실제 보행 시간 충족은 검증되지 않았습니다.`
                : `徒歩${walkLimit[1]}分の条件は直線距離${radiusMeters}m以内の候補に限定しただけで、実際の徒歩時間は未確認です。`,
            ]
          : []),
        isKo
          ? `'${stopName}' 장소를 교체하면 새로운 장소와의 이동 시간 및 일정이 자동으로 재계산됩니다.`
          : `「${stopName}」を変更すると新しいスポットとの移動時間と旅程が自動で再計算されます。`,
        ...(repQuery && /조용|静か/.test(repQuery)
          ? [
              isKo
                ? '조용한 분위기는 현재 공식 장소 데이터로 검증할 수 없어 카테고리와 거리만 반영했습니다.'
                : '静かな雰囲気は公式データで確認できないため、カテゴリと距離のみを反映しました。',
            ]
          : []),
      ],
    };

    const initialPrompt = isKo
      ? `🔄 **'${stopName}'** 대신 방문할 수 있는 추천 대체 장소 ${alternatives.length}곳을 준비했습니다.\n마음에 드는 장소를 선택하여 승인해 주세요! ✨`
      : `🔄 **「${stopName}」**の代わりに訪問できるおすすめ代替スポット${alternatives.length}件をご用意しました。\n気になるスポットをお選びいただき、承認してください！✨`;

    return {
      pendingAction,
      alternatives,
      status: 'awaiting_confirmation',
      responseMessage: initialPrompt,
    };
  };
}
