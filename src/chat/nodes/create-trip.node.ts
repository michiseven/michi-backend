import type { TripsService } from '../../trips/trips.service';
import type { ChatState, ChatUpdate } from '../chat-state';
import { generationFailure } from '../generation-failure';

export function createCreateTripNode(tripsService: TripsService) {
  return async (state: ChatState): Promise<ChatUpdate> => {
    const input = state.createTripInput;
    const isKo = state.locale === 'ko';

    const lastMsg = state.messages[state.messages.length - 1];
    const rawText = typeof lastMsg?.content === 'string' ? lastMsg.content : '서울 여행';

    const area = input?.startArea || '성수';

    try {
      const generated = await tripsService.generate({
        text: input?.text || rawText,
        startArea: area,
        travelDate: input?.travelDate,
        startDate: input?.startDate,
        endDate: input?.endDate,
        // 자연어에 포함된 시간을 TripsService의 검증된 preference parser가 해석하게 둔다.
        // 여기서 기본값을 넣으면 사용자가 말한 13:00 같은 시간이 11:00으로 덮인다.
        startTime: input?.startTime,
        endTime: input?.endTime,
        budget: input?.budget,
        budgetScope: input?.budgetScope,
        hotel: input?.hotel,
        airport: input?.airport,
        arrivalAirport: input?.arrivalAirport,
        departureAirport: input?.departureAirport,
        partySize: input?.partySize,
        companions: input?.companions,
        pace: input?.pace,
        safetyConstraints: input?.safetyConstraints,
        hasLuggage: input?.hasLuggage,
        relaxations: state.relaxations,
        mealPreference: input?.mealPreference,
        mealCuisine: input?.mealCuisine,
      });

      const currency = new Intl.NumberFormat(isKo ? 'ko-KR' : 'ja-JP');
      let costFeedback = '';
      if (generated.trip.estimatedTotalCost != null && input?.budget) {
        costFeedback = isKo
          ? `\n💰 1인 예상 비용은 약 ${currency.format(generated.trip.estimatedTotalCost)}원으로, 요청하신 ${currency.format(input.budget)}원 예산 범위 내에 맞추었습니다.`
          : `\n💰 1人あたりの予想費用は約${currency.format(generated.trip.estimatedTotalCost)}ウォンです。`;
      }

      const responseMessage = isKo
        ? `✨ **${area}** 맞춤 여행 일정이 완성되었습니다! 🎉${costFeedback}\n\n지도와 타임라인에서 상세 장소와 이동 동선을 확인해 보세요. 특정 장소를 변경하고 싶으시면 말씀해 주세요!`
        : `✨ **${area}**のおすすめ旅程が完成しました！🎉${costFeedback}\n\nマップとタイムラインで詳細ルートをご確認いただけます。気になるスポットの変更もお気軽にどうぞ！`;

      const generatedStops = generated.trip.stops ?? [];
      const cafeStops = generatedStops.filter((stop) =>
        /cafe|카페|커피/i.test(stop.category ?? ''),
      );
      const mealStops = generatedStops.filter((stop) => stop.stopType === 'meal');
      const targetFor = (
        stops: typeof generatedStops,
      ): { stopId: string; stopOrder: number; placeName: string } | undefined =>
        stops.length === 1
          ? { stopId: stops[0]!.id, stopOrder: stops[0]!.order, placeName: stops[0]!.placeName }
          : undefined;
      const actionChips = isKo
        ? [
            {
              label:
                cafeStops.length === 1
                  ? '☕ 이 카페 다른 곳으로 바꿔줘'
                  : '☕ 바꿀 카페를 선택할게요',
              query:
                cafeStops.length === 1
                  ? `${area}에서 다른 카페로 바꿔줘`
                  : '카페 장소를 선택해서 바꿔줘',
              type: 'refine',
              mutationTarget: targetFor(cafeStops),
            },
            {
              label:
                mealStops.length === 1
                  ? '🥩 이 식사 장소 다른 곳으로 바꿔줘'
                  : '🥩 바꿀 식사 장소를 선택할게요',
              query:
                mealStops.length === 1
                  ? '이 식사 장소를 다른 맛집으로 바꿔줘'
                  : '식사 장소를 선택해서 바꿔줘',
              type: 'refine',
              mutationTarget: targetFor(mealStops),
            },
            {
              label: '❓ 이 일정 전체 요약',
              query: '현재 일정 전체를 요약해줘',
              type: 'summary',
              intent: 'trip_summary' as const,
            },
          ]
        : [
            {
              label: cafeStops.length === 1 ? '☕ このカフェを変更' : '☕ 変更するカフェを選ぶ',
              query:
                cafeStops.length === 1 ? `${area}の別のカフェに変えて` : '変更するカフェを選んで',
              type: 'refine',
              mutationTarget: targetFor(cafeStops),
            },
            {
              label:
                mealStops.length === 1
                  ? '🥩 この食事スポットを変更'
                  : '🥩 変更する食事スポットを選ぶ',
              query:
                mealStops.length === 1
                  ? 'この食事スポットを別の人気店に変えて'
                  : '変更する食事スポットを選んで',
              type: 'refine',
              mutationTarget: targetFor(mealStops),
            },
            {
              label: '❓ この旅程を要約',
              query: '現在の旅程全体を要約して',
              type: 'summary',
              intent: 'trip_summary' as const,
            },
          ];

      return {
        resultTripId: generated.trip.id,
        // TripDto에는 원래 editToken이 없고, 최상위 generated.editToken은 이 state에 넣지 않는다.
        // ChatService가 생성 직후 DB에서 조회해 HTTP 응답으로만 한 번 전달한다.
        resultTrip: generated.trip,
        responseMessage,
        actionChips,
        status: 'completed',
      };
    } catch (err) {
      const failure = generationFailure(err, state.locale);
      return {
        responseMessage: failure.message,
        actionChips: failure.chips,
        errorCode: failure.code,
        status: 'failed',
      };
    }
  };
}
