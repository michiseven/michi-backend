import type { Repository } from 'typeorm';
import type { Trip } from '../../database/entities';
import type { ChatState, ChatUpdate } from '../chat-state';

export function createSummarizeTripNode(tripsRepo: Repository<Trip>) {
  return async (state: ChatState): Promise<ChatUpdate> => {
    const isKo = state.locale === 'ko';
    if (!state.currentTripId) {
      return {
        status: 'completed',
        errorCode: 'NO_ACTIVE_TRIP',
        responseMessage: isKo
          ? '요약할 현재 일정이 없습니다. 먼저 여행 일정을 만들어 주세요.'
          : '要約する現在の旅程がありません。まず旅程を作成してください。',
      };
    }
    const trip = await tripsRepo.findOne({
      where: { id: state.currentTripId },
      relations: ['stops', 'stops.place'],
    });
    const stops = [...(trip?.stops ?? [])].sort((left, right) => left.order - right.order);
    if (stops.length === 0) {
      return {
        status: 'completed',
        errorCode: 'TRIP_NOT_FOUND',
        responseMessage: isKo
          ? '일정의 장소 정보를 찾지 못했습니다.'
          : '旅程のスポット情報を取得できませんでした。',
      };
    }
    const lines = stops.map((stop) => {
      const route = stop.inboundRoute;
      const travel = route?.durationMinutes
        ? isKo
          ? ` · 이전 장소에서 ${route.durationMinutes}분 이동`
          : ` · 前のスポットから${route.durationMinutes}分移動`
        : '';
      return `${stop.order}. ${stop.place?.name ?? (isKo ? '장소' : 'スポット')}${travel}`;
    });
    const meals = stops.filter((stop) => stop.stopType === 'meal');
    const mealText = meals.length
      ? isKo
        ? `식사: ${meals.map((stop) => stop.place?.name ?? '식사 장소').join(', ')}`
        : `食事: ${meals.map((stop) => stop.place?.name ?? '食事スポット').join('、')}`
      : isKo
        ? '식사 장소: 별도로 지정되지 않았습니다.'
        : '食事スポット: 個別には指定されていません。';
    return {
      status: 'completed',
      errorCode: null,
      responseMessage: isKo
        ? `현재 일정 요약\n${lines.join('\n')}\n${mealText}`
        : `現在の旅程の要約\n${lines.join('\n')}\n${mealText}`,
    };
  };
}
