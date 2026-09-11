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

  it('keeps an LLM-requested meal choice structured so its chips are answerable', async () => {
    const node = createClassifyIntentNode(
      'test-key',
      jest.fn().mockResolvedValue({
        intent: 'clarify',
        clarificationKind: 'meal',
        createTripInput: {
          text: '명동에서 가족과 반나절 코스를 만들고 싶어',
          startArea: '명동',
        },
      }) as never,
    );

    const update = await node({
      messages: [new HumanMessage('명동에서 가족과 반나절 코스를 만들고 싶어')],
      locale: 'ko',
      pendingQuestion: null,
      pendingCreateTripInput: null,
      mealCuisine: null,
      mealPreference: null,
      responseMessage: null,
    } as unknown as ChatState);

    expect(update.intent).toBe('clarify');
    expect(update.pendingQuestion).toMatchObject({ target: 'meal' });
    expect(update.pendingCreateTripInput).toMatchObject({ startArea: '명동' });
  });

  it('recovers the original area when a checkpoint lost the pending meal request', async () => {
    const node = createClassifyIntentNode(
      'test-key',
      jest.fn().mockResolvedValue({ intent: 'qa' }) as never,
    );

    const update = await node({
      messages: [
        new HumanMessage('梨泰院でビーガン対応のランチと雑貨ショッピングをしたい。'),
        new HumanMessage('local_specialty'),
      ],
      locale: 'ja',
      pendingQuestion: {
        id: 'meal-choice-1',
        target: 'meal',
        reason: 'meal_choice_required',
        revision: 1,
        options: [{ id: 'local_specialty', mealPreference: 'local_specialty' }],
      },
      pendingCreateTripInput: null,
      structuredChoice: { questionId: 'meal-choice-1', optionId: 'local_specialty' },
      mealCuisine: null,
      mealPreference: 'local_specialty',
      responseMessage: null,
    } as unknown as ChatState);

    expect(update.intent).toBe('create_trip');
    expect(update.createTripInput).toMatchObject({
      text: '梨泰院でビーガン対応のランチと雑貨ショッピングをしたい。',
      startArea: '이태원',
      mealPreference: 'local_specialty',
    });
  });

  it('does not let an LLM replace a concrete Japanese area-and-activity request with a vague prompt', async () => {
    const node = createClassifyIntentNode(
      'test-key',
      jest.fn().mockResolvedValue({ intent: 'clarify', clarificationKind: 'general' }) as never,
    );

    const update = await node({
      messages: [new HumanMessage('西村で韓屋カフェと伝統工芸を見たい。')],
      locale: 'ja',
      pendingQuestion: null,
      pendingCreateTripInput: null,
      mealCuisine: null,
      mealPreference: null,
      responseMessage: null,
    } as unknown as ChatState);

    expect(update.intent).toBe('create_trip');
    expect(update.createTripInput).toMatchObject({
      text: '西村で韓屋カフェと伝統工芸を見たい。',
      startArea: '서촌',
    });
  });
});
