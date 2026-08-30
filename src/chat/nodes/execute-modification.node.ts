import type { RunnableConfig } from '@langchain/core/runnables';
import type { TripsService } from '../../trips/trips.service';
import type { ChatState, ChatUpdate } from '../chat-state';

export function createExecuteModificationNode(tripsService: TripsService) {
  return async (state: ChatState, config?: RunnableConfig): Promise<ChatUpdate> => {
    const isKo = state.locale === 'ko';
    const pending = state.pendingAction;

    if (state.status === 'rejected' || state.status === 'failed' || !pending) {
      return {};
    }

    const tripId = pending.tripId;
    const stopId = pending.targetStop.stopId;
    const oldName = pending.targetStop.placeName;
    const action = pending.action;
    const editToken = config?.configurable?.editToken as string | undefined;

    try {
      if (action === 'remove') {
        const updated = await tripsService.patchStops(
          tripId,
          { action: 'remove', stopId },
          editToken,
        );

        return {
          resultTripId: updated.trip.id,
          resultTrip: updated.trip,
          responseMessage: isKo
            ? `🗑️ **'${oldName}'** 장소를 일정에서 제외하고 이동 동선을 깔끔하게 재조정했습니다. ✨`
            : `🗑️ **「${oldName}」**を旅程から削除し、移動ルートを最適化しました。✨`,
          status: 'completed',
          pendingAction: null,
        };
      }

      if (action === 'replace') {
        const chosenPlaceId = state.modification?.chosenPlaceId;
        const chosenCandidate = pending.alternatives.find((a) => a.placeId === chosenPlaceId);

        if (!chosenCandidate) {
          return {
            status: 'failed',
            responseMessage: isKo
              ? '교체할 대체 장소 정보를 찾지 못했습니다.'
              : '代替スポット情報が見つかりませんでした。',
            errorCode: 'REPLACEMENT_NOT_FOUND',
            pendingAction: null,
          };
        }

        const updated = await tripsService.patchStops(
          tripId,
          {
            action: 'replace',
            stopId,
            newPlaceId: chosenCandidate.placeId,
          },
          editToken,
        );

        return {
          resultTripId: updated.trip.id,
          resultTrip: updated.trip,
          responseMessage: isKo
            ? `✨ **'${oldName}'**(을)를 새로운 추천 장소인 **'${chosenCandidate.name}'**(으)로 교체하고 최적 동선으로 업데이트했습니다! 🎉`
            : `✨ **「${oldName}」**を新しいおすすめ**「${chosenCandidate.name}」**に変更し、最適なルートに更新しました！🎉`,
          status: 'completed',
          pendingAction: null,
        };
      }

      return {};
    } catch (err: unknown) {
      const isForbidden =
        typeof err === 'object' &&
        err !== null &&
        (('status' in err && (err as { status: number }).status === 403) ||
          ('response' in err &&
            typeof (err as { response?: { code?: string } }).response === 'object' &&
            (err as { response?: { code?: string } }).response?.code === 'TRIP_EDIT_FORBIDDEN'));

      const errMsg = isForbidden
        ? isKo
          ? '일정 편집 권한이 없습니다. (편집 토큰이 일치하지 않거나 만료되었습니다)'
          : 'プランの編集権限がありません。（編集トークンが無効です）'
        : err instanceof Error
          ? err.message
          : isKo
            ? '일정 수정 중 오류가 발생했습니다.'
            : 'プランの変更中にエラーが発生しました。';

      return {
        status: 'failed',
        errorCode: isForbidden ? 'TRIP_EDIT_FORBIDDEN' : 'MUTATION_FAILED',
        responseMessage: errMsg,
        pendingAction: null,
      };
    }
  };
}
