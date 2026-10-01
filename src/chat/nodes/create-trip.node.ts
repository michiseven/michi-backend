import type { TripsService } from '../../trips/trips.service';
import { Logger } from '@nestjs/common';
import type { ChatState, ChatUpdate } from '../chat-state';
import { generationFailure } from '../generation-failure';
import { groundedRecoveryQuestion } from '../grounded-recovery-question';
import { isUnassignedGapWarning } from '../../trips/route-unassigned-gap-warnings';
import { PlaceSearchAgentQuestion } from '../../trips/initial-place-search-agent';

export function createCreateTripNode(tripsService: TripsService, apiKey?: string) {
  const logger = new Logger('CreateTripNode');
  return async (state: ChatState): Promise<ChatUpdate> => {
    const input = state.createTripInput;
    const isKo = state.locale === 'ko';

    const lastMsg = state.messages[state.messages.length - 1];
    const rawText = typeof lastMsg?.content === 'string' ? lastMsg.content : '서울 여행';

    try {
      const generated = await tripsService.generate({
        text: input?.text || rawText,
        startArea: input?.startArea,
        locale: state.locale,
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

      // The parser is the source of truth after generation. The request area
      // can be inferred or normalized, while the saved preference is the area
      // actually used for candidate search and the itinerary title.
      const generatedPreference = generated.trip.preference as
        { area?: unknown; days?: Array<{ area?: unknown }> } | undefined;
      const generatedArea =
        typeof generatedPreference?.area === 'string'
          ? generatedPreference.area
          : typeof generatedPreference?.days?.[0]?.area === 'string'
            ? generatedPreference.days[0].area
            : undefined;
      const area = generatedArea ?? input?.startArea ?? (isKo ? '서울' : 'ソウル');

      const currency = new Intl.NumberFormat(isKo ? 'ko-KR' : 'ja-JP');
      let costFeedback = '';
      if (generated.trip.estimatedTotalCost != null && generated.trip.budgetInput) {
        const budgetInput = generated.trip.budgetInput;
        costFeedback = isKo
          ? `\n확인된 예상 비용은 ${currency.format(generated.trip.estimatedTotalCost)}원입니다. 요청 예산은 ${budgetInput.scope === 'per_person' ? '1인당' : '전체'} ${currency.format(budgetInput.amountKrw)}원이며, 확인되지 않은 비용은 포함하지 않았습니다.`
          : `\n確認済み費用は${currency.format(generated.trip.estimatedTotalCost)}ウォンです。指定予算は${budgetInput.scope === 'per_person' ? '1人あたり' : '全体'}${currency.format(budgetInput.amountKrw)}ウォンで、未確認の費用は含まれていません。`;
      }

      const isPartial =
        generated.trip.contractAssessment?.status === 'partial' ||
        generated.trip.status === 'partial' ||
        generated.trip.safetyConstraints?.requiresUserConfirmation === true;
      const incompleteConditions =
        generated.trip.safetyConstraints?.requiresUserConfirmation === true
          ? isKo
            ? '요청한 안전·접근성 조건은 장소별 근거가 없어 아직 확인하지 못했습니다. 방문 전 공식 정보로 확인해야 합니다.'
            : '指定された安全性・アクセシビリティ条件は施設ごとの根拠がなく、未確認です。訪問前に公式情報で確認してください。'
          : generated.trip.contractAssessment?.status === 'partial'
            ? isKo
              ? '공항 이동시간·터미널 또는 짐 보관 조건은 아직 검증되지 않았습니다. 이동시간과 보관 가능 여부 확인이 필요합니다.'
              : '空港への移動時間・ターミナルまたは荷物預かり条件は未確認です。'
            : isKo
              ? '요청 시간대 중 아직 채우지 못한 시간이 있습니다. 타임라인의 자유 시간을 확인해 주세요.'
              : '指定時間帯に未充足の時間があります。タイムラインの自由時間を確認してください。';
      const scheduleGapFeedback = (generated.warnings ?? [])
        .filter(isUnassignedGapWarning)
        .join('\n');
      const responseMessage =
        (isPartial
          ? isKo
            ? `${area} 시내 일정 초안을 만들었습니다. ${incompleteConditions} 전체 요청이 완료된 것은 아니며, 요청 조건은 유지했습니다.${costFeedback}`
            : `${area}の市内旅程の下書きを作成しました。${incompleteConditions} 旅程全体はまだ完成していません。指定条件は保持しています。${costFeedback}`
          : isKo
            ? `✨ **${area}** 맞춤 여행 일정이 완성되었습니다! 🎉${costFeedback}\n\n지도와 타임라인에서 상세 장소와 이동 동선을 확인해 보세요. 특정 장소를 변경하고 싶으시면 말씀해 주세요!`
            : `✨ **${area}**のおすすめ旅程が完成しました！🎉${costFeedback}\n\nマップとタイムラインで詳細ルートをご確認いただけます。気になるスポットの変更もお気軽にどうぞ！`) +
        (scheduleGapFeedback ? `\n\n${scheduleGapFeedback}` : '');

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
      if (err instanceof PlaceSearchAgentQuestion) {
        return {
          responseMessage: err.question,
          pendingCreateTripInput: input ?? { text: rawText },
          intent: 'clarify',
          status: 'completed',
          errorCode: null,
          pendingAction: null,
          actionChips: [],
        };
      }
      logger.warn(
        `Trip generation failed in chat: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      const failure = generationFailure(err, state.locale);
      const canClarify = [
        'THEME_EVIDENCE_MISSING',
        'MEAL_CUISINE_NOT_FOUND',
        'AREA_FILTER_UNAVAILABLE',
        'CATEGORY_CANDIDATES_NOT_FOUND',
      ].includes(failure.code);
      const question = canClarify
        ? await groundedRecoveryQuestion(
            apiKey,
            input?.text || rawText,
            failure.message,
            state.locale,
          )
        : null;
      return {
        responseMessage: question ?? failure.message,
        pendingCreateTripInput: canClarify ? input : null,
        actionChips: failure.chips,
        errorCode: failure.code,
        status: 'failed',
      };
    }
  };
}
