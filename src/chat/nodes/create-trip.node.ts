import { HttpException } from '@nestjs/common';
import type { TripsService } from '../../trips/trips.service';
import type { TripGenerationRecovery } from '../../trips/trip-generation-recovery';
import type { ChatState, ChatUpdate } from '../chat-state';

function recoveryFrom(error: unknown): TripGenerationRecovery | null {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  if (!response || typeof response !== 'object') return null;
  const recovery = (response as { recovery?: unknown }).recovery;
  if (!recovery || typeof recovery !== 'object') return null;
  const candidate = recovery as Partial<TripGenerationRecovery>;
  return Array.isArray(candidate.actions) && typeof candidate.reason === 'string'
    ? (candidate as TripGenerationRecovery)
    : null;
}

function recoveryLabel(id: string, locale: 'ko' | 'ja'): string {
  const labels =
    locale === 'ko'
      ? {
          meal_cuisine: '음식 종류 조건 없이 다시 찾기',
          search_radius: '인근 지역까지 포함해 다시 찾기',
          route_constraints: '이동 제약을 완화해 다시 계산하기',
        }
      : {
          meal_cuisine: '料理の条件を外して探し直す',
          search_radius: '近くのエリアまで広げて探し直す',
          route_constraints: '移動条件を緩めて計算し直す',
        };
  return (
    labels[id as keyof typeof labels] ??
    (locale === 'ko' ? '조건을 바꿔 다시 찾기' : '条件を変えて探し直す')
  );
}

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

      const actionChips = isKo
        ? [
            {
              label: '☕ 카페 다른 곳으로 바꿔줘',
              query: `${area}에서 다른 카페로 바꿔줘`,
              type: 'refine',
            },
            {
              label: '🥩 저녁 맛집 다른 곳 추천해줘',
              query: '저녁 식사 장소를 다른 맛집으로 추천해서 바꿔줘',
              type: 'refine',
            },
            {
              label: '❓ 이 일정 장소들 설명해줘',
              query: '이 코스의 장소들에 대해 설명해줘',
              type: 'clarify',
            },
          ]
        : [
            { label: '☕ 別のカフェに変更', query: `${area}の別のカフェに変えて`, type: 'refine' },
            {
              label: '🥩 別のグルメに変更',
              query: '夕食の場所を別の人気店に変えて',
              type: 'refine',
            },
            {
              label: '❓ スポットの見どころは？',
              query: 'このコースの見どころを教えて',
              type: 'clarify',
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
      const recovery = recoveryFrom(err);
      return {
        responseMessage: isKo
          ? recovery
            ? '조건에 맞는 장소를 모두 찾지 못했어요. 아래에서 원하는 조건 완화를 선택해 다시 찾아볼 수 있어요.'
            : '일정을 만들지 못했어요. 조건을 고쳐서 다시 시도해 주세요.'
          : recovery
            ? '条件に合うスポットをすべて見つけられませんでした。下から条件を調整して、もう一度探せます。'
            : '旅程を作成できませんでした。条件を修正してもう一度お試しください。',
        errorCode: 'CREATE_TRIP_FAILED',
        status: 'failed',
        actionChips:
          recovery?.actions.map((item) => ({
            label: recoveryLabel(item.id, state.locale),
            query: recoveryLabel(item.id, state.locale),
            type: `recovery:${item.id}`,
          })) ?? [],
      };
    }
  };
}
