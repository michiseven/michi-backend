import type { Repository } from 'typeorm';
import type { Trip, TripStop } from '../../database/entities';
import type { ChatState, ChatUpdate } from '../chat-state';

export function createResolveModificationTargetNode(tripsRepo: Repository<Trip>) {
  return async (state: ChatState): Promise<ChatUpdate> => {
    const isKo = state.locale === 'ko';

    if (!state.currentTripId) {
      return {
        responseMessage: isKo
          ? '현재 수정할 활성 일정이 없습니다. 먼저 여행 일정을 생성해 주세요! 😊'
          : '修正対象のプランがありません。まずはプランを作成してください！😊',
        status: 'completed',
        errorCode: 'NO_ACTIVE_TRIP',
      };
    }

    const trip = await tripsRepo.findOne({
      where: { id: state.currentTripId },
      relations: ['stops', 'stops.place'],
    });

    if (!trip || !trip.stops || trip.stops.length === 0) {
      return {
        responseMessage: isKo
          ? '수정할 일정 정보를 찾지 못했습니다. 다시 일정을 생성하거나 불러와 주세요.'
          : 'プラン情報を取得できませんでした。',
        status: 'completed',
        errorCode: 'TRIP_NOT_FOUND',
      };
    }

    const currentStops = [...trip.stops].sort((a, b) => a.order - b.order);
    const mod = state.modification;

    let targetStop: TripStop | undefined;

    // 1. Match by explicit stopId
    if (mod?.targetStopId) {
      targetStop = currentStops.find((s) => s.id === mod.targetStopId);
    }

    // 2. Match by order (1-indexed)
    if (!targetStop && mod?.targetStopOrder) {
      targetStop = currentStops.find((s) => s.order === mod.targetStopOrder);
    }

    // 3. Match by place name
    if (!targetStop && mod?.targetPlaceName) {
      const cleanTarget = mod.targetPlaceName.toLowerCase().replace(/\s+/g, '');
      const matchingStops = currentStops.filter((s) => {
        const name = (s.place?.name || '').toLowerCase().replace(/\s+/g, '');
        return name.includes(cleanTarget) || cleanTarget.includes(name);
      });

      if (matchingStops.length === 1) {
        targetStop = matchingStops[0];
      }
    }

    // 4. Fallback search by category keyword in query (e.g. "카페", "저녁", "점심", "식당")
    if (!targetStop) {
      const lastMsg = state.messages[state.messages.length - 1];
      const text = typeof lastMsg?.content === 'string' ? lastMsg.content : '';

      if (/카페|커피|カフェ|珈琲/.test(text)) {
        const cafeStops = currentStops.filter((s) =>
          /카페|음료|디저트|cafe|coffee|カフェ/i.test(
            s.place?.category || s.place?.rawCategory || '',
          ),
        );
        if (cafeStops.length === 1) {
          targetStop = cafeStops[0];
        }
      } else if (/저녁|저녁식사|디너|夕食|ディナー/.test(text)) {
        // Last meal stop or dinner stop
        const foodStops = currentStops.filter((s) =>
          /음식점|식당|한식|일식|양식|고기|맛집|グルメ|レストラン/i.test(
            s.place?.category || s.place?.rawCategory || '',
          ),
        );
        if (foodStops.length > 0) {
          targetStop = foodStops[foodStops.length - 1];
        }
      }
    }

    // CRITICAL: NEVER FALLBACK TO 1ST STOP ARBITRARILY!
    if (!targetStop) {
      const stopChips = currentStops.map((s, idx) => ({
        label: `${idx + 1}. ${s.place?.name || '장소'}`,
        query: `${idx + 1}번째 ${s.place?.name || '장소'} 다른 곳으로 바꿔줘`,
        type: 'refine',
      }));

      return {
        responseMessage: isKo
          ? '어떤 장소를 변경할지 특정하지 못했습니다. 아래 일정 목록 중 변경하고 싶은 장소를 선택해 주세요.'
          : '変更対象のスポットを特定できませんでした。以下のリストから変更したいスポットをお選びください。',
        actionChips: stopChips,
        status: 'completed',
        errorCode: 'TARGET_AMBIGUOUS',
      };
    }

    const action = mod?.action || 'replace';
    const stopName = targetStop.place?.name || '장소';

    return {
      modification: {
        action,
        targetStopId: targetStop.id,
        targetStopOrder: targetStop.order,
        targetPlaceName: stopName,
        replacementQuery: mod?.replacementQuery || null,
      },
    };
  };
}
