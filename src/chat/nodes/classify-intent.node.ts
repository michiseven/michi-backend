import type { ChatState, ChatUpdate } from '../chat-state';
import { classifyIntentRuleBased } from '../chat-intent';

export function createClassifyIntentNode() {
  return (state: ChatState): Promise<ChatUpdate> => {
    // If validation node already completed response (e.g. North Korea check)
    if (state.responseMessage) {
      return Promise.resolve({});
    }

    const lastMsg = state.messages[state.messages.length - 1];
    const text = typeof lastMsg?.content === 'string' ? lastMsg.content : '';
    const hasActiveTrip = Boolean(state.currentTripId);

    const classification = classifyIntentRuleBased(text, hasActiveTrip);
    const form = state.formTripContext;
    const mod = classification.modification;
    const modification = mod
      ? {
          action: mod.action,
          targetStopId: mod.targetStopId ?? null,
          targetStopOrder: mod.targetStopOrder,
          targetPlaceName: mod.targetPlaceName,
          replacementQuery: mod.replacementQuery ?? null,
        }
      : null;

    const createTripInput = classification.createTripInput
      ? {
          ...classification.createTripInput,
          // 입국일의 첫 일정 시작, 출국일의 마지막 일정 종료라는 의미로만 전달한다.
          // 실제 다일차 일자별 후보·동선 산정은 TripsService가 계속 담당한다.
          travelDate: form?.arrivalDate ?? classification.createTripInput.travelDate,
          startDate: form?.arrivalDate,
          endDate: form?.departureDate,
          startTime: form?.arrivalTime ?? classification.createTripInput.startTime,
          endTime: form?.departureTime ?? classification.createTripInput.endTime,
          hotel: form?.hotel ?? classification.createTripInput.hotel,
        }
      : null;

    return Promise.resolve({
      intent: classification.intent,
      modification,
      createTripInput,
    });
  };
}
