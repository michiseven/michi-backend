import { UnprocessableEntityException } from '@nestjs/common';
import { createCreateTripNode } from './create-trip.node';
import type { ChatState } from '../chat-state';

describe('createCreateTripNode', () => {
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
});
