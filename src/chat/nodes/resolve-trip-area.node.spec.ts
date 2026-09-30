import { createResolveTripAreaNode } from './resolve-trip-area.node';
import type { ChatState } from '../chat-state';

describe('resolve trip area', () => {
  it('uses known boundaries without inventing model coordinates', async () => {
    const query = jest.fn();
    const result = await createResolveTripAreaNode({ query } as never)({
      createTripInput: { text: '鐘路で散歩', startArea: '鐘路' },
      locale: 'ja',
    } as ChatState);
    expect(result.createTripInput).toMatchObject({ startArea: '종로' });
    expect(query).not.toHaveBeenCalled();
  });
  it('resolves neighbourhoods outside the static search list using spatial data', async () => {
    const query = jest.fn().mockResolvedValue([{ name: '혜화동' }]);
    const result = await createResolveTripAreaNode({ query } as never)({
      createTripInput: { text: '혜화 산책', startArea: '혜화' },
      locale: 'ko',
    } as ChatState);
    expect(result.createTripInput).toMatchObject({ startArea: '혜화동' });
  });
  it('retains the request and asks for a location when no boundary is available', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const input = { text: '모르는 동네 산책', startArea: '모르는동네' };
    const result = await createResolveTripAreaNode({ query } as never)({
      createTripInput: input,
      locale: 'ko',
    } as ChatState);
    expect(result.intent).toBe('clarify');
    expect(result.pendingCreateTripInput).toEqual(input);
    expect(result.clarificationQuestion).toContain('역 이름');
  });
});
