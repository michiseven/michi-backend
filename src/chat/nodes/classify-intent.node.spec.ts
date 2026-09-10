import { HumanMessage } from '@langchain/core/messages';
import { createClassifyIntentNode } from './classify-intent.node';
import type { ChatState } from '../chat-state';

describe('createClassifyIntentNode meal clarification contract', () => {
  it('forces meal clarification when the LLM incorrectly says create_trip', async () => {
    const llmClassifier = jest.fn().mockResolvedValue({
      intent: 'create_trip',
      createTripInput: {
        text: '홍대에서 13시부터 18시까지 점심 먹고 카페와 산책하고 싶어',
        startArea: '성수',
      },
    });
    const node = createClassifyIntentNode('test-key', llmClassifier as never);

    const update = await node({
      messages: [new HumanMessage('홍대에서 13시부터 18시까지 점심 먹고 카페와 산책하고 싶어')],
      locale: 'ko',
      pendingQuestion: null,
      pendingCreateTripInput: null,
      mealCuisine: null,
      mealPreference: null,
      responseMessage: null,
    } as unknown as ChatState);

    expect(update.intent).toBe('clarify');
    expect(update.clarificationKind).toBe('meal');
    expect(update.pendingQuestion).toMatchObject({
      target: 'meal',
      reason: 'meal_choice_required',
    });
    expect(update.createTripInput).toMatchObject({
      text: '홍대에서 13시부터 18시까지 점심 먹고 카페와 산책하고 싶어',
      startArea: '홍대',
    });
    expect(llmClassifier).toHaveBeenCalledTimes(1);
  });
});
