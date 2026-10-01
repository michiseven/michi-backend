import { HumanMessage } from '@langchain/core/messages';
import type { Repository } from 'typeorm';
import type { Place, Trip } from '../../database/entities';
import type { ChatState } from '../chat-state';
import { createFindReplacementCandidatesNode } from './find-replacement-candidates.node';
import { createResolveModificationTargetNode } from './resolve-modification-target.node';

describe('replacement request hard constraints', () => {
  const original = {
    id: 'old',
    name: '공덕로스터리',
    category: 'cafe',
    district: '마포구',
    location: { type: 'Point', coordinates: [126.951, 37.544] },
  } as Place;
  const trip = {
    id: 'trip',
    stops: [
      { id: 's1', order: 1, placeId: 'old', place: original },
      {
        id: 's2',
        order: 2,
        placeId: 'old2',
        place: { ...original, id: 'old2', name: '포멜로빈 공덕점' },
      },
    ],
  } as Trip;
  const candidate = (
    id: string,
    name: string,
    rawCategory: string,
    coords = [126.924, 37.558],
  ): Place =>
    ({
      id,
      name,
      rawCategory,
      category: 'cafe',
      district: '마포구',
      location: { type: 'Point', coordinates: coords },
    }) as Place;

  function setup(candidates: Place[]): {
    qb: { where: jest.Mock; andWhere: jest.Mock; take: jest.Mock; getMany: jest.Mock };
    places: Repository<Place>;
    trips: Repository<Trip>;
    find: ReturnType<typeof createFindReplacementCandidatesNode>;
  } {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(candidates),
    };
    const places = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as Repository<Place>;
    const trips = { findOne: jest.fn().mockResolvedValue(trip) } as unknown as Repository<Trip>;
    return { qb, places, trips, find: createFindReplacementCandidatesNode(places, trips) };
  }
  it('shows one physical 비파티세리 venue and fills the choice limit with distinct eligible cafes', async () => {
    const duplicate = (id: string, longitude: number): Place => ({
      ...candidate(id, '비파티세리 공덕점', '음식점>카페', [longitude, 37.544]),
      source: 'naver-local',
      sourcePlaceId: id,
      roadAddress: '서울특별시 마포구 마포대로 14길 23',
    });
    const rows = [
      duplicate('duplicate-b', 126.95106),
      duplicate('duplicate-a', 126.951),
      duplicate('duplicate-c', 126.95105),
      candidate('other-1', '공덕 커피', '음식점>카페', [126.952, 37.544]),
      candidate('other-2', '마포 찻집', '음식점>카페', [126.953, 37.544]),
    ];
    const state = {
      locale: 'ko',
      currentTripId: 'trip',
      messages: [new HumanMessage('1번째 장소를 다른 카페로 바꿔줘')],
      modification: { action: 'replace', targetStopId: 's1', replacementQuery: '다른 카페' },
    } as ChatState;
    const result = (await setup(rows).find(state)) as Partial<ChatState>;
    expect(result.alternatives?.map((p) => p.placeId)).toEqual([
      'duplicate-a',
      'other-1',
      'other-2',
    ]);
    expect(result.pendingAction?.alternatives).toEqual(result.alternatives);
    const reordered = (await setup([...rows].reverse()).find(state)) as Partial<ChatState>;
    expect(reordered.alternatives).toEqual(result.alternatives);
    const one = (await setup(rows.slice(0, 3)).find(state)) as Partial<ChatState>;
    expect(one.alternatives).toHaveLength(1);
  });

  it('retains Hongdae station radius through unresolved target selection; excludes Gongdeok, study cafes and source restaurants', async () => {
    const { trips, find, qb } = setup([
      candidate('good', '홍대 커피', '음식점>카페'),
      candidate('far', '공덕 카페', '음식점>카페', [126.951, 37.544]),
      candidate('border', '홍대 외곽 카페', '음식점>카페', [126.924, 37.569]),
      candidate('study', '홍대 스터디카페', '음식점>카페'),
      candidate('restaurant', '씨카페', '음식점>양식'),
      candidate('unknown', '카페 미확인', ''),
    ]);
    const query = '홍대입구역 도보 15분 이내 일반 카페로 바꿔줘. 스터디카페는 제외';
    const state = {
      locale: 'ko',
      currentTripId: 'trip',
      messages: [new HumanMessage(query)],
      modification: { action: 'replace', targetStopId: null, replacementQuery: query },
    } as ChatState;
    const unresolved = (await createResolveModificationTargetNode(trips)(
      state,
    )) as Partial<ChatState>;
    expect(unresolved.errorCode).toBe('TARGET_AMBIGUOUS');
    expect(unresolved.pendingModification?.replacementQuery).toBe(query);
    expect(unresolved.pendingAction).toBeUndefined();
    const selected = {
      ...state,
      modification: { ...unresolved.pendingModification!, targetStopId: 's1' },
      messages: [new HumanMessage('1번째 장소를 다른 곳으로 바꿔줘')],
    };
    const resolved = await createResolveModificationTargetNode(trips)(selected);
    const result = (await find({ ...selected, ...resolved } as ChatState)) as Partial<ChatState>;
    expect(result.alternatives?.map((p) => p.placeId).sort()).toEqual(['good', 'unknown']);
    expect(result.status).toBe('awaiting_confirmation');
    expect(result.pendingAction?.warnings.join(' ')).toContain('실제 보행 시간');
    expect(result.alternatives?.[0]?.reason).toContain('직선거리');
    expect(qb.andWhere).toHaveBeenCalledWith('p.district = :dist', { dist: '마포구' });
  });

  it('fails without loosening an explicit radius when no valid candidate is found', async () => {
    const { find } = setup([candidate('far', '공덕 커피', '음식점>카페', [126.951, 37.544])]);
    const result = await find({
      currentTripId: 'trip',
      locale: 'ko',
      messages: [],
      modification: {
        action: 'replace',
        targetStopId: 's1',
        replacementQuery: '홍대입구역 도보 15분 이내 카페로 바꿔줘',
      },
    } as unknown as ChatState);
    expect(result.errorCode).toBe('NO_REPLACEMENT_CANDIDATES');
    expect(result.pendingAction).toBeUndefined();
  });

  it('filters ordinary cafe replacements out of an explicit traditional tea edit', async () => {
    const { find } = setup([
      candidate('coffee', '카멜커피', '음식점>카페'),
      candidate('tea', '인사동 찻집', '음식점>카페>전통찻집'),
    ]);
    const result = (await find({
      locale: 'ja',
      currentTripId: 'trip',
      messages: [new HumanMessage('伝統茶を飲める店に変えて')],
      modification: { action: 'replace', targetStopId: 's1', replacementQuery: '伝統茶' },
    } as ChatState)) as Partial<ChatState>;
    expect(result.alternatives?.map((item) => item.placeId)).toEqual(['tea']);
  });
});
