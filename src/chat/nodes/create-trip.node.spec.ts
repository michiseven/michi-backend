import { UnprocessableEntityException } from '@nestjs/common';
import { createCreateTripNode } from './create-trip.node';
import type { ChatState } from '../chat-state';

describe('createCreateTripNode', () => {
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
