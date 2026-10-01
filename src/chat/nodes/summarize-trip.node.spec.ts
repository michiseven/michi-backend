import type { Repository } from 'typeorm';
import type { Trip } from '../../database/entities';
import type { ChatState } from '../chat-state';
import { extractExplicitRequestContract } from '../../preferences/explicit-request-contract';
import { createSummarizeTripNode } from './summarize-trip.node';

describe('departure summary from a reloaded trip contract', () => {
  it.each(['ko', 'ja'])('retains clocks and unresolved transfer/luggage in %s', async (locale) => {
    const text = '공덕 호텔11시 체크아웃, 캐리어, 관광11–16시, ICN T1 18시 도착 마감, 비행20:30';
    const stored = JSON.parse(JSON.stringify(extractExplicitRequestContract(text))) as unknown;
    const findOne = jest.fn().mockResolvedValue({
      id: 'trip',
      preference: { validatedJson: { explicitRequestContract: stored }, originalText: text },
      stops: [{ order: 1, place: { name: '공덕소담길' } }],
    });
    const repo = { findOne } as unknown as Repository<Trip>;
    const result = await createSummarizeTripNode(repo)({
      currentTripId: 'trip',
      locale,
    } as ChatState);
    expect(result.responseMessage).toContain('16:00');
    expect(result.responseMessage).toContain('18:00');
    expect(result.responseMessage).toContain('20:30');
    expect(result.responseMessage).toContain('11:00');
    expect(result.responseMessage).toContain(locale === 'ko' ? '미확인' : '未確認');
    expect(findOne).toHaveBeenCalledWith({
      where: { id: 'trip' },
      relations: ['stops', 'stops.place', 'preference'],
    });
  });
});
