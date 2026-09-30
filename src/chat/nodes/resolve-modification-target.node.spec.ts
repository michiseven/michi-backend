import { HumanMessage } from '@langchain/core/messages';
import type { Repository } from 'typeorm';
import type { Trip } from '../../database/entities';
import type { ChatState } from '../chat-state';
import { createResolveModificationTargetNode } from './resolve-modification-target.node';

describe('resolve target safeguards', () => {
  it('does not match a partial landmark name or arbitrary first stop', async () => {
    const repo = {
      findOne: jest.fn().mockResolvedValue({
        stops: [
          { id: 'cafe', order: 1, place: { name: '스타벅스 경복궁사거리점', category: 'cafe' } },
        ],
      }),
    } as unknown as Repository<Trip>;
    const result = await createResolveModificationTargetNode(repo)({
      currentTripId: 'trip',
      locale: 'ko',
      messages: [new HumanMessage('경복궁 대신 다른 관광지로 변경')],
      modification: {
        action: 'replace',
        targetPlaceName: '경복궁',
        targetStopId: null,
        replacementQuery: '관광지',
      },
    } as ChatState);
    expect(result.errorCode).toBe('TARGET_AMBIGUOUS');
    expect(result.modification).toBeUndefined();
  });
});
