import { HumanMessage } from '@langchain/core/messages';
import { createClassifyIntentNode } from './classify-intent.node';
import type { ChatState } from '../chat-state';

describe('createClassifyIntentNode meal clarification contract', () => {
  it.each(['현재 전체 일정을 요약해줘', '現在の旅程全体を要約して'])(
    'routes the natural current-trip summary without model interpretation: %s',
    async (text) => {
      const llm = jest.fn().mockResolvedValue({ intent: 'create_trip' });
      const result = await createClassifyIntentNode(
        'test',
        llm as never,
      )({ currentTripId: 'trip', messages: [new HumanMessage(text)], locale: 'ko' } as ChatState);
      expect(result.intent).toBe('summarize_trip');
      expect(llm).not.toHaveBeenCalled();
    },
  );
  it('does not restart meal choice or generation for an active airport/luggage followup', async () => {
    const node = createClassifyIntentNode(
      'test',
      jest.fn().mockResolvedValue({ intent: 'clarify', clarificationKind: 'meal' }) as never,
    );
    const result = await node({
      currentTripId: 'trip',
      messages: [new HumanMessage('짐 회수와 공항 18시 도착 조건이 빠졌는데 어떻게 돼?')],
      mealCuisine: 'korean',
      locale: 'ko',
    } as ChatState);
    expect(result.intent).toBe('qa');
    expect(result.pendingQuestion).toBeUndefined();
    expect(result.clarificationKind).not.toBe('meal');
  });

  it('keeps replacement area and exclusion constraints even when LLM loses mutation fields', async () => {
    const node = createClassifyIntentNode(
      'test',
      jest.fn().mockResolvedValue({ intent: 'modify_trip' }) as never,
    );
    const text = '홍대입구역 도보 15분 이내 일반 카페로 바꿔줘. 스터디카페는 제외';
    const result = await node({
      currentTripId: 'trip',
      messages: [new HumanMessage(text)],
      locale: 'ko',
    } as ChatState);
    expect(result.intent).toBe('modify_trip');
    expect(result.modification).toMatchObject({ action: 'replace', replacementQuery: text });
  });
  it('preserves a direction question even when the model also proposes an area and activity', async () => {
    const node = createClassifyIntentNode(
      'test-key',
      jest.fn().mockResolvedValue({
        intent: 'clarify',
        readiness: 'needs_one_answer',
        missingRequirement: 'direction',
        activities: ['관광'],
        clarificationKind: 'general',
        clarificationQuestion: 'どんな体験をしてみたいですか？',
        createTripInput: { text: '友達と週末にソウルで遊びたい。', startArea: '홍대' },
      }) as never,
    );
    const update = await node({
      messages: [new HumanMessage('友達と週末にソウルで遊びたい。')],
      locale: 'ja',
      responseMessage: null,
      pendingQuestion: null,
      pendingCreateTripInput: null,
    } as unknown as ChatState);
    expect(update.intent).toBe('clarify');
    expect(update.clarificationQuestion).toBe('どんな体験をしてみたいですか？');
  });

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
      jest.fn().mockResolvedValue({
        intent: 'clarify',
        clarificationKind: 'general',
        activities: ['한옥 카페', '전통 공예'],
        createTripInput: { text: '西村で韓屋カフェと伝統工芸を見たい。', startArea: '서촌' },
      }) as never,
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

  it('accepts an LLM-understood request that the rule fallback cannot classify', async () => {
    const node = createClassifyIntentNode(
      'test',
      jest.fn().mockResolvedValue({
        intent: 'create_trip',
        activities: ['전통찻집', '역사 산책'],
        createTripInput: { text: 'original', startArea: '종로' },
      }) as never,
    );
    const text =
      '종로에서 고즈넉한 한옥 전통찻집과 역사적인 산책길을 걷고 싶어요. 차분하게 서울의 정취를 느끼고 싶습니다.';
    const result = await node({ messages: [new HumanMessage(text)], locale: 'ko' } as ChatState);
    expect(result.intent).toBe('create_trip');
    expect(result.createTripInput).toMatchObject({ text, startArea: '종로' });
  });

  it('does not require an alias for an LLM-understood neighbourhood', async () => {
    const node = createClassifyIntentNode(
      'test',
      jest.fn().mockResolvedValue({
        intent: 'create_trip',
        createTripInput: { text: 'original', startArea: '혜화' },
      }) as never,
    );
    const result = await node({
      messages: [new HumanMessage('혜화 연극')],
      locale: 'ko',
    } as ChatState);
    expect(result.intent).toBe('create_trip');
    expect(result.createTripInput).toMatchObject({ startArea: '혜화' });
  });

  it('retains a specific unresolved question and original request for its next answer', async () => {
    const classify = jest
      .fn()
      .mockResolvedValueOnce({
        intent: 'clarify',
        missingRequirement: 'area',
        activities: ['산책'],
        clarificationQuestion: '어느 동네에서 출발하시나요?',
        createTripInput: { text: '산책하고 싶어요' },
      })
      .mockResolvedValueOnce({
        intent: 'create_trip',
        createTripInput: { text: '혜화', startArea: '혜화' },
      });
    const node = createClassifyIntentNode('test', classify as never);
    const first = await node({
      messages: [new HumanMessage('산책하고 싶어요')],
      locale: 'ko',
    } as ChatState);
    expect(first.clarificationQuestion).toBe('어느 동네에서 출발하시나요?');
    const second = await node({
      ...first,
      messages: [new HumanMessage('혜화')],
      locale: 'ko',
    } as ChatState);
    expect(second.createTripInput).toMatchObject({ text: '산책하고 싶어요\n추가 답변: 혜화' });
  });
});
