import { UnprocessableEntityException } from '@nestjs/common';
import { createCreateTripNode } from './create-trip.node';
import type { ChatState } from '../chat-state';
import { PlaceSearchAgentQuestion } from '../../trips/initial-place-search-agent';

describe('createCreateTripNode', () => {
  it('returns the agent question and retains the original request for the next user answer', async () => {
    const question = '전통차를 원하세요, 커피를 원하세요?';
    const node = createCreateTripNode({
      generate: jest.fn().mockRejectedValue(new PlaceSearchAgentQuestion(question)),
    } as never);
    const input = { text: '공덕 카페 11시부터16시', startArea: '공덕' };
    const update = await node({
      locale: 'ko',
      messages: [],
      createTripInput: input,
    } as unknown as ChatState);
    expect(update.responseMessage).toBe(question);
    expect(update.pendingCreateTripInput).toEqual(input);
    expect(update.intent).toBe('clarify');
    expect(update.status).toBe('completed');
    expect(update.errorCode).toBeNull();
    expect(update.pendingAction).toBeNull();
    expect(update.resultTrip).toBeUndefined();
  });
  it.each(['ko', 'ja'] as const)(
    'connects gap disclosure to a completed itinerary in %s',
    async (locale) => {
      const warning =
        locale === 'ko'
          ? '14:00–17:00은 활동 미배정 180분 구간입니다(이동시간 포함). 이동시간의 확인된 근거가 없어 자유 시간을 산정할 수 없습니다.'
          : '14:00–17:00は活動が未割り当ての180分間です（移動時間を含みます）。移動時間の確認済み根拠がないため、自由時間は算定できません。';
      const node = createCreateTripNode({
        generate: jest.fn().mockResolvedValue({
          trip: { id: 'ready-with-gap', status: 'ready', stops: [] },
          warnings: [warning, 'unrelated provider warning'],
        }),
      } as never);
      const update = await node({
        locale,
        messages: [],
        createTripInput: { text: '카페와 저녁', startArea: '홍대' },
      } as unknown as ChatState);
      expect(update.responseMessage).toContain(locale === 'ko' ? '완성되었습니다' : '完成しました');
      expect(update.responseMessage).toContain(warning);
      expect(update.responseMessage).not.toContain('unrelated provider warning');
      expect(update.status).toBe('completed');
    },
  );
  it('does not claim completion for unknown stroller access or invent airport conditions', async () => {
    const node = createCreateTripNode({
      generate: jest.fn().mockResolvedValue({
        trip: {
          id: 'family',
          status: 'ready',
          stops: [],
          safetyConstraints: { requiresUserConfirmation: true },
        },
      }),
    } as never);
    const update = await node({
      locale: 'ko',
      messages: [],
      createTripInput: { text: '유모차' },
      relaxations: [],
    } as unknown as ChatState);
    expect(update.responseMessage).toContain('초안');
    expect(update.responseMessage).toContain('안전·접근성');
    expect(update.responseMessage).not.toContain('공항');
    expect(update.responseMessage).not.toContain('완성되었습니다');
  });
  it('never claims completion or budget fulfillment for an unverified airport draft', async () => {
    const node = createCreateTripNode({
      generate: jest.fn().mockResolvedValue({
        trip: {
          id: 'partial',
          status: 'partial',
          contractAssessment: { status: 'partial', unavailable: [] },
          estimatedTotalCost: 5000,
          budgetInput: { amountKrw: 30000, scope: 'total' },
          stops: [],
        },
      }),
    } as never);
    const update = await node({
      locale: 'ko',
      messages: [],
      createTripInput: { text: '공항 17시까지 짐 보관' },
      relaxations: [],
    } as unknown as ChatState);
    expect(update.responseMessage).toContain('초안');
    expect(update.responseMessage).not.toContain('완성되었습니다');
    expect(update.responseMessage).not.toContain('예산 범위 내');
    expect(update.responseMessage).toContain('전체 30,000원');
  });
  it('returns a structured summary intent and never targets an arbitrary last meal', async () => {
    const node = createCreateTripNode({
      generate: jest.fn().mockResolvedValue({
        trip: {
          id: 'trip-1',
          estimatedTotalCost: null,
          stops: [
            { id: 'cafe-1', order: 1, placeName: '카페 A', category: 'cafe', stopType: 'general' },
            {
              id: 'meal-1',
              order: 2,
              placeName: '식당 A',
              category: 'restaurant',
              stopType: 'meal',
            },
            {
              id: 'meal-2',
              order: 3,
              placeName: '식당 B',
              category: 'restaurant',
              stopType: 'meal',
            },
          ],
        },
      }),
    } as never);

    const update = await node({
      locale: 'ko',
      messages: [],
      createTripInput: { text: '성수 일정', startArea: '성수' },
      relaxations: [],
    } as unknown as ChatState);

    expect(update.actionChips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mutationTarget: { stopId: 'cafe-1', stopOrder: 1, placeName: '카페 A' },
        }),
        expect.objectContaining({
          label: '🥩 바꿀 식사 장소를 선택할게요',
          mutationTarget: undefined,
        }),
        expect.objectContaining({ intent: 'trip_summary' }),
      ]),
    );
  });

  it('keeps explicit relaxations and returns stable Japanese recovery without internal details', async () => {
    const generate = jest.fn().mockRejectedValue(
      new UnprocessableEntityException({
        code: 'MEAL_CUISINE_NOT_FOUND',
        message: 'internal provider detail',
      }),
    );
    const node = createCreateTripNode({ generate } as never);

    const update = await node({
      locale: 'ja',
      messages: [],
      createTripInput: { text: '聖水でサムギョプサルを食べたい', startArea: '성수' },
      relaxations: ['meal_cuisine'],
    } as unknown as ChatState);

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ relaxations: ['meal_cuisine'] }),
    );
    expect(update).toMatchObject({
      status: 'failed',
      errorCode: 'MEAL_CUISINE_NOT_FOUND',
    });
    expect(update.actionChips).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'refine', label: '料理を変更' })]),
    );
    expect(update.responseMessage).toContain('料理');
    expect(update.responseMessage).not.toContain('internal provider detail');
  });

  it('passes locale and uses the generated preference area in the response title', async () => {
    const generate = jest.fn().mockResolvedValue({
      trip: {
        id: 'trip-area',
        estimatedTotalCost: null,
        preference: { area: '홍대', days: [{ area: '홍대' }] },
        stops: [],
      },
    });
    const node = createCreateTripNode({ generate } as never);

    const update = await node({
      locale: 'ja',
      messages: [],
      createTripInput: { text: '弘大でカフェに行きたい', startArea: '성수' },
      relaxations: [],
    } as unknown as ChatState);

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ startArea: '성수', locale: 'ja' }),
    );
    expect(update.responseMessage).toContain('홍대');
    expect(update.responseMessage).not.toContain('성수');
  });
});
