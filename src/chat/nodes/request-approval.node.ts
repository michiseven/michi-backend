import { interrupt } from '@langchain/langgraph';
import type { ChatState, ChatUpdate, ResumePayload } from '../chat-state';

export function createRequestApprovalNode() {
  return (state: ChatState): Promise<ChatUpdate> => {
    const isKo = state.locale === 'ko';
    const pending = state.pendingAction;

    if (!pending) {
      return Promise.resolve({ status: 'completed' });
    }

    // PAUSE GRAPH EXECUTION HERE via LangGraph interrupt()!
    // The graph pauses and checkpoints state. It resumes when Command({ resume: payload }) is supplied.
    const resumeValue = (interrupt(pending) || {}) as unknown as ResumePayload;

    // Process human decision upon resume
    if (resumeValue.decision === 'reject') {
      return Promise.resolve({
        status: 'rejected',
        responseMessage: isKo
          ? `일정 수정을 취소했습니다. 기존 일정이 그대로 유지됩니다. 😊`
          : `プランの変更をキャンセルしました。元の旅程がそのまま維持されます。😊`,
        pendingAction: null,
      });
    }

    if (resumeValue.decision === 'approve') {
      if (pending.action === 'replace') {
        const chosenId = resumeValue.chosenPlaceId;
        const validAlt = pending.alternatives.find((a) => a.placeId === chosenId);

        if (!chosenId || !validAlt) {
          return Promise.resolve({
            status: 'failed',
            responseMessage: isKo
              ? '유효한 대체 장소가 선택되지 않았습니다. 추천 목록에서 장소를 선택해 주세요.'
              : '有効な代替スポットが選択されませんでした。おすすめリストからお選びください。',
            errorCode: 'INVALID_CHOSEN_PLACE',
            pendingAction: null,
          });
        }

        return Promise.resolve({
          status: 'completed',
          modification: {
            ...state.modification,
            action: 'replace',
            targetStopId: pending.targetStop.stopId,
            replacementQuery: validAlt.name,
            chosenPlaceId: validAlt.placeId,
          },
        });
      }

      // Remove approval
      return Promise.resolve({
        status: 'completed',
        modification: {
          ...state.modification,
          action: 'remove',
          targetStopId: pending.targetStop.stopId,
          replacementQuery: null,
        },
      });
    }

    return Promise.resolve({});
  };
}
