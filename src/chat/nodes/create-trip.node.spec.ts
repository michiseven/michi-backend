import { UnprocessableEntityException } from '@nestjs/common';
import { createCreateTripNode } from './create-trip.node';
import type { ChatState } from '../chat-state';

describe('createCreateTripNode', () => {
  it('passes an explicit recovery relaxation and returns localized recovery chips', async () => {
    const generate = jest.fn().mockRejectedValue(
      new UnprocessableEntityException({
        code: 'NO_CANDIDATES',
        recovery: {
          reason: 'meal_cuisine_unavailable',
          dayNumber: 1,
          area: '성수',
          actions: [
            {
              id: 'meal_cuisine',
              label: '음식 종류 조건 없이 다시 찾기',
              requestPatch: { relaxations: ['meal_cuisine'] },
            },
          ],
        },
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
      actionChips: [
        expect.objectContaining({
          type: 'recovery:meal_cuisine',
          label: '料理の条件を外して探し直す',
        }),
      ],
    });
    expect(update.responseMessage).not.toContain('조건에 맞는');
  });
});
