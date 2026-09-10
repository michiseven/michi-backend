import type { ChatCreateTripInput, ChatState, ChatUpdate } from '../chat-state';
import {
  classifyIntentRuleBased,
  delegatesMealChoice,
  extractExplicitSeoulArea,
  extractMealCuisine,
  extractExplicitTimeWindow,
  requiresMealClarification,
} from '../chat-intent';
import { classifyIntentWithLlm } from '../chat-intent-llm';

const MEAL_QUESTION_OPTIONS = [
  { id: 'korean', mealCuisine: 'korean' as const },
  { id: 'japanese', mealCuisine: 'japanese' as const },
  { id: 'chinese', mealCuisine: 'chinese' as const },
  { id: 'western', mealCuisine: 'western' as const },
  { id: 'cafe_dessert', mealCuisine: 'cafe_dessert' as const },
  { id: 'local_specialty', mealPreference: 'local_specialty' as const },
];

export function createClassifyIntentNode(
  openaiApiKey?: string,
  llmClassifier: typeof classifyIntentWithLlm = classifyIntentWithLlm,
) {
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
      (await llmClassifier(openaiApiKey, text, hasActiveTrip, conversation)) ??
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

    // A meal answer is a state transition, not a fresh request. Keep the
    // original request so a chip or a short answer cannot discard its area,
    // time window, or activities.
    const structuredOption =
      state.pendingQuestion && state.structuredChoice?.questionId === state.pendingQuestion.id
        ? state.pendingQuestion.options.find(
            (option) => option.id === state.structuredChoice?.optionId,
          )
        : undefined;
    const hasStructuredChoice = Boolean(state.structuredChoice);
    const answerCuisine =
      structuredOption?.mealCuisine ??
      (!hasStructuredChoice ? (state.mealCuisine ?? extractMealCuisine(text)) : undefined);
    const answerDelegates =
      structuredOption?.mealPreference === 'local_specialty' ||
      (!hasStructuredChoice &&
        (state.mealPreference === 'local_specialty' || delegatesMealChoice(text)));
    const answersPendingMeal =
      state.pendingQuestion?.target === 'meal' &&
      (Boolean(answerCuisine) || answerDelegates) &&
      classification.intent !== 'qa';
    const hasStructuredMealChoice = Boolean(
      state.mealCuisine || state.mealPreference || state.structuredChoice,
    );
    const forceMealClarification =
      !answersPendingMeal &&
      !hasStructuredMealChoice &&
      requiresMealClarification(text) &&
      classification.intent !== 'qa';

    // ChatService initializes this context on every request, so an ignored
    // profile cannot leak from a LangGraph checkpoint into an example request.
    const forcedLocalSpecialty = answersPendingMeal
      ? answerDelegates
      : state.mealPreference === 'local_specialty';
    const forcedMealCuisine = answersPendingMeal
      ? Boolean(answerCuisine)
      : Boolean(state.mealCuisine);
    const explicitArea = extractExplicitSeoulArea(text);
    const explicitTimeWindow = extractExplicitTimeWindow(text);
    const classifiedTripInput = classification.createTripInput
      ? {
          ...classification.createTripInput,
          // The user's explicit area outranks an inferred area returned by the LLM.
          ...(explicitArea ? { startArea: explicitArea } : {}),
        }
      : null;
    // The LLM intentionally returns only the clarification payload. Build the
    // pending request from the deterministic extractor as a lossless fallback
    // so the next structured choice still has the original context.
    const deterministicTripInput = classifyIntentRuleBased(text, false).createTripInput ?? null;
    const asksForMeal =
      forceMealClarification ||
      (classification.intent === 'clarify' && classification.clarificationKind === 'meal');
    const pendingTripInput =
      answersPendingMeal && state.pendingCreateTripInput
        ? {
            ...state.pendingCreateTripInput,
            // A follow-up may answer the meal question and explicitly move the
            // plan at the same time ("강남에서 한식으로").
            ...(explicitArea ? { startArea: explicitArea } : {}),
            ...explicitTimeWindow,
          }
        : null;
    const baseTripInput: ChatCreateTripInput | null =
      pendingTripInput ??
      classifiedTripInput ??
      (asksForMeal || forcedLocalSpecialty || forcedMealCuisine ? deterministicTripInput : null);
    const createTripInput = baseTripInput
      ? {
          ...baseTripInput,
          // 입국일의 첫 일정 시작, 출국일의 마지막 일정 종료라는 의미로만 전달한다.
          // 실제 다일차 일자별 후보·동선 산정은 TripsService가 계속 담당한다.
          travelDate: form?.arrivalDate ?? baseTripInput.travelDate,
          startDate: form?.arrivalDate ?? baseTripInput.startDate,
          endDate: form?.departureDate ?? baseTripInput.endDate,
          startTime: form?.arrivalTime ?? baseTripInput.startTime,
          endTime: form?.departureTime ?? baseTripInput.endTime,
          arrivalAirport: form?.arrivalAirport ?? baseTripInput.arrivalAirport,
          departureAirport: form?.departureAirport ?? baseTripInput.departureAirport,
          hotel: form?.hotel ?? baseTripInput.hotel,
          partySize: form?.partySize ?? baseTripInput.partySize,
          budget: form?.budget ?? baseTripInput.budget,
          budgetScope: form?.budgetScope ?? baseTripInput.budgetScope,
          companions: form?.companions ?? baseTripInput.companions,
          pace: form?.pace ?? baseTripInput.pace,
          safetyConstraints: form?.safetyConstraints ?? baseTripInput.safetyConstraints,
          hasLuggage: form?.hasLuggage ?? baseTripInput.hasLuggage,
          ...(forcedLocalSpecialty ? { mealPreference: 'local_specialty' as const } : {}),
          ...(forcedMealCuisine && answerCuisine ? { mealCuisine: answerCuisine } : {}),
        }
      : null;

    const nextPendingQuestion = answersPendingMeal
      ? null
      : asksForMeal
        ? {
            target: 'meal' as const,
            reason: 'meal_choice_required' as const,
            revision: state.messages.length,
            id: `meal-choice-${state.messages.length}`,
            options: MEAL_QUESTION_OPTIONS,
          }
        : classification.intent === 'create_trip'
          ? null
          : state.pendingQuestion;
    const nextPendingTripInput = answersPendingMeal
      ? null
      : asksForMeal
        ? createTripInput
        : classification.intent === 'create_trip'
          ? null
          : state.pendingCreateTripInput;

    return {
      intent: answersPendingMeal
        ? 'create_trip'
        : selectedTarget
          ? 'modify_trip'
          : state.chatIntent === 'trip_summary'
            ? 'summarize_trip'
            : forcedLocalSpecialty
              ? 'create_trip'
              : forcedMealCuisine
                ? 'create_trip'
                : forceMealClarification
                  ? 'clarify'
                  : classification.intent,
      clarificationQuestion: forceMealClarification
        ? null
        : (classification.clarificationQuestion ?? null),
      clarificationKind: forceMealClarification
        ? 'meal'
        : (classification.clarificationKind ?? null),
      modification,
      createTripInput,
      pendingQuestion: nextPendingQuestion,
      pendingCreateTripInput: nextPendingTripInput,
    };
  };
}
