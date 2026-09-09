import type { ChatState, ChatUpdate } from '../chat-state';
import { classifyIntentRuleBased } from '../chat-intent';
import { classifyIntentWithLlm } from '../chat-intent-llm';

export function createClassifyIntentNode(openaiApiKey?: string) {
  return async (state: ChatState): Promise<ChatUpdate> => {
    // If validation node already completed response (e.g. North Korea check)
    if (state.responseMessage) {
      return {};
    }

    const lastMsg = state.messages[state.messages.length - 1];
    const text = typeof lastMsg?.content === 'string' ? lastMsg.content : '';
    const hasActiveTrip = Boolean(state.currentTripId);

    const conversation = state.messages
      .slice(-6)
      .map((message) => (typeof message.content === 'string' ? message.content : ''))
      .filter(Boolean)
      .join('\n');
    const classification =
      (await classifyIntentWithLlm(openaiApiKey, text, hasActiveTrip, conversation)) ??
      classifyIntentRuleBased(text, hasActiveTrip);
    const form = state.formTripContext;
    const mod = classification.modification;
    // A stop selected in the UI is authoritative session input. Do not feed its
    // localized label back through intent parsing, which could pick another stop.
    const selectedTarget = state.modification?.targetStopId ? state.modification : null;
    const modification = selectedTarget
      ? selectedTarget
      : mod
        ? {
            action: mod.action,
            targetStopId: mod.targetStopId ?? null,
            targetStopOrder: mod.targetStopOrder,
            targetPlaceName: mod.targetPlaceName,
            replacementQuery: mod.replacementQuery ?? null,
          }
        : null;

    // ChatService initializes this context on every request, so an ignored
    // profile cannot leak from a LangGraph checkpoint into an example request.
    const forcedLocalSpecialty = state.mealPreference === 'local_specialty';
    const forcedMealCuisine = Boolean(state.mealCuisine);
    const baseTripInput =
      classification.createTripInput ??
      (forcedLocalSpecialty || forcedMealCuisine
        ? classifyIntentRuleBased(text, false).createTripInput
        : null);
    const createTripInput = baseTripInput
      ? {
          ...baseTripInput,
          // 입국일의 첫 일정 시작, 출국일의 마지막 일정 종료라는 의미로만 전달한다.
          // 실제 다일차 일자별 후보·동선 산정은 TripsService가 계속 담당한다.
          travelDate: form?.arrivalDate ?? baseTripInput.travelDate,
          startDate: form?.arrivalDate,
          endDate: form?.departureDate,
          startTime: form?.arrivalTime ?? baseTripInput.startTime,
          endTime: form?.departureTime ?? baseTripInput.endTime,
          arrivalAirport: form?.arrivalAirport,
          departureAirport: form?.departureAirport,
          hotel: form?.hotel ?? baseTripInput.hotel,
          partySize: form?.partySize ?? baseTripInput.partySize,
          budget: form?.budget ?? baseTripInput.budget,
          budgetScope: form?.budgetScope,
          companions: form?.companions,
          pace: form?.pace,
          safetyConstraints: form?.safetyConstraints,
          hasLuggage: form?.hasLuggage,
          ...(forcedLocalSpecialty ? { mealPreference: 'local_specialty' as const } : {}),
          ...(state.mealCuisine ? { mealCuisine: state.mealCuisine } : {}),
        }
      : null;

    return {
      intent: selectedTarget
        ? 'modify_trip'
        : state.chatIntent === 'trip_summary'
          ? 'summarize_trip'
          : forcedLocalSpecialty
            ? 'create_trip'
            : forcedMealCuisine
              ? 'create_trip'
              : classification.intent,
      clarificationQuestion: classification.clarificationQuestion ?? null,
      clarificationKind: classification.clarificationKind ?? null,
      modification,
      createTripInput,
    };
  };
}
