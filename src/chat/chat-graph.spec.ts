/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { MemorySaver, Command } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { createChatGraph } from './chat-graph';
import type { Place, Trip } from '../database/entities';
import { placeQueryPhrases } from './nodes/load-verified-facts.node';

describe('LangGraph Chat Workflow (createChatGraph)', () => {
  let mockPlacesRepo: any;
  let mockTripsRepo: any;
  let mockTripsService: any;
  let checkpointer: MemorySaver;
  let graph: ReturnType<typeof createChatGraph>;

  const samplePlace1 = {
    id: 'p-1',
    name: '이상의집',
    category: '관광지',
    district: '종로구',
    address: '서울 종로구 자하문로7길 18',
    roadAddress: '서울 종로구 자하문로7길 18',
    source: 'kakao-local',
    sourcePlaceId: 'k-1',
    rawPayload: {
      overview: '시인 이상의 생가 터에 조성된 문화 공간입니다.',
      place_url: 'https://place.map.kakao.com/12345',
    },
    location: { type: 'Point', coordinates: [126.971, 37.581] },
  } as unknown as Place;

  const samplePlace2 = {
    id: 'p-2',
    name: '토속촌 삼계탕',
    category: '음식점',
    district: '종로구',
    address: '서울 종로구 자하문로5길 5',
    source: 'kakao-local',
    location: { type: 'Point', coordinates: [126.972, 37.579] },
  } as unknown as Place;

  const samplePlace3 = {
    id: 'p-alt-1',
    name: '대체 식당',
    category: '음식점',
    district: '종로구',
    address: '서울 종로구 누하동',
    source: 'kakao-local',
    location: { type: 'Point', coordinates: [126.97, 37.58] },
  } as unknown as Place;

  const sampleTrip = {
    id: 'trip-100',
    providerMode: 'live',
    editToken: 'valid-secret-edit-token-123',
    stops: [
      {
        id: 'stop-1',
        order: 1,
        placeId: 'p-1',
        place: samplePlace1,
      },
      {
        id: 'stop-2',
        order: 2,
        placeId: 'p-2',
        place: samplePlace2,
      },
    ],
  } as unknown as Trip;

  beforeEach(() => {
    checkpointer = new MemorySaver();

    mockPlacesRepo = {
      createQueryBuilder: jest.fn<any>().mockReturnValue({
        where: jest.fn<any>().mockReturnThis(),
        andWhere: jest.fn<any>().mockReturnThis(),
        take: jest.fn<any>().mockReturnThis(),
        getOne: jest.fn<any>().mockResolvedValue(samplePlace1),
        getMany: jest.fn<any>().mockResolvedValue([samplePlace3]),
      }),
      findOne: jest.fn<any>().mockResolvedValue(samplePlace1),
    };

    mockTripsRepo = {
      findOne: jest.fn<any>().mockResolvedValue(sampleTrip),
    };

    mockTripsService = {
      generate: jest.fn<any>().mockResolvedValue({
        trip: { id: 'trip-new', estimatedTotalCost: 50000 },
        editToken: 'new-token-999',
      }),
      patchStops: jest
        .fn<any>()
        .mockImplementation((_id: string, _dto: any, editToken?: string) => {
          if (editToken !== 'valid-secret-edit-token-123') {
            const err = new Error('You do not have permission to modify this trip.');
            Object.assign(err, { status: 403, response: { code: 'TRIP_EDIT_FORBIDDEN' } });
            return Promise.reject(err);
          }
          return Promise.resolve({
            trip: { id: 'trip-100', status: 'modified' },
          });
        }),
    };

    graph = createChatGraph({
      placesRepo: mockPlacesRepo,
      tripsRepo: mockTripsRepo,
      tripsService: mockTripsService,
      openaiApiKey: undefined,
      checkpointer,
    });
  });

  it('searches the longest normalized place phrase before a broad area keyword', () => {
    expect(
      placeQueryPhrases('성수동 대림창고 갤러리의 최신 영업시간과 가격을 출처와 함께 알려줘')[0],
    ).toBe('성수동 대림창고 갤러리');
  });

  it('answers grounded questions with verified place facts and reports missing business hours/price', async () => {
    const threadId = 'thread-qa-1';
    const config = { configurable: { thread_id: threadId } };

    const result: any = await graph.invoke(
      {
        messages: [new HumanMessage('이상의집 영업시간이랑 가격 알려줘')],
        locale: 'ko',
      },
      config,
    );

    expect(result.status).toBe('completed');
    expect(result.responseMessage).toContain('이상의집');
    expect(result.responseMessage).toContain('확인할 수 없습니다');
    expect(result.verifiedPlaceFacts).toBeDefined();
    expect(result.verifiedPlaceFacts.name).toBe('이상의집');
    expect(result.actionChips).toBeDefined();
    expect(mockTripsService.patchStops).not.toHaveBeenCalled();
  });

  it('enriches missing place hours and prices with cited web evidence on demand', async () => {
    const enrichment = {
      enrich: jest.fn<any>().mockResolvedValue({
        provider: 'openai-web-search',
        model: 'gpt-test',
        status: 'sourced',
        evidence: {
          placeMatched: true,
          matchedName: '이상의집',
          matchedAddress: '서울 종로구 자하문로7길 18',
          businessHours: {
            status: 'sourced',
            value: '화요일~일요일 10:00~18:00',
            sources: [{ title: '공식 사이트', url: 'https://example.com/hours' }],
          },
          price: {
            status: 'sourced',
            value: '입장 무료',
            sources: [{ title: '공식 사이트', url: 'https://example.com/price' }],
          },
          warnings: [],
        },
        fetchedAt: '2026-08-29T00:00:00.000Z',
        expiresAt: '2026-08-30T00:00:00.000Z',
        cacheHit: false,
      }),
    };
    const enrichedGraph = createChatGraph({
      placesRepo: mockPlacesRepo,
      tripsRepo: mockTripsRepo,
      tripsService: mockTripsService,
      placeDetailEnrichment: enrichment,
      checkpointer: new MemorySaver(),
    });

    const result: any = await enrichedGraph.invoke(
      {
        messages: [new HumanMessage('이상의집의 최신 영업시간과 가격을 알려줘')],
        locale: 'ko',
      },
      { configurable: { thread_id: 'thread-web-evidence' } },
    );

    expect(enrichment.enrich).toHaveBeenCalledTimes(1);
    expect(result.responseMessage).toContain('웹 검색 근거 운영시간');
    expect(result.responseMessage).toContain('입장 무료');
    expect(result.verifiedPlaceFacts.webEvidence.status).toBe('sourced');
  });

  it('matches the localized Korean alias of a place in the active trip', async () => {
    const localizedPlace = {
      ...samplePlace1,
      id: 'p-localized',
      name: 'ソンスドン・テリムチャンゴ・ギャラリー（성수동 대림창고 갤러리）',
    };
    mockTripsRepo.findOne.mockResolvedValueOnce({
      id: 'trip-localized',
      stops: [
        {
          id: 'stop-localized',
          order: 1,
          placeId: localizedPlace.id,
          place: localizedPlace,
        },
      ],
    });

    const result: any = await graph.invoke(
      {
        messages: [new HumanMessage('성수동 대림창고 갤러리의 영업시간과 가격을 알려줘')],
        currentTripId: 'trip-localized',
        locale: 'ko',
      },
      { configurable: { thread_id: 'thread-localized-qa' } },
    );

    expect(result.verifiedPlaceFacts?.placeId).toBe('p-localized');
    expect(result.verifiedPlaceFacts?.name).toBe('성수동 대림창고 갤러리');
  });

  it('clarifies vague trip requests with helpful action starter chips', async () => {
    const threadId = 'thread-clarify-1';
    const config = { configurable: { thread_id: threadId } };

    const result: any = await graph.invoke(
      {
        messages: [new HumanMessage('서울 여행 추천해줘')],
        locale: 'ko',
      },
      config,
    );

    expect(result.status).toBe('completed');
    expect(result.responseMessage).toContain('분위기의 서울 여행');
    expect(result.actionChips.length).toBeGreaterThan(0);
    expect(mockTripsService.patchStops).not.toHaveBeenCalled();
  });

  it('creates a new trip using TripsService.generate and sanitizes editToken from ChatState', async () => {
    const threadId = 'thread-create-1';
    const config = { configurable: { thread_id: threadId } };

    const result: any = await graph.invoke(
      {
        messages: [new HumanMessage('성수동에서 카페 가고 삼겹살 먹는 일정 짜줘')],
        locale: 'ko',
      },
      config,
    );

    expect(result.status).toBe('completed');
    expect(result.resultTripId).toBe('trip-new');
    expect(result.resultTrip.editToken).toBeUndefined();
    expect(mockTripsService.generate).toHaveBeenCalledTimes(1);
    expect(mockTripsService.generate).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: undefined, endTime: undefined }),
    );

    // Verify Checkpoint state does NOT contain editToken
    const snapshot = await graph.getState(config);
    expect(snapshot.values.resultTrip?.editToken).toBeUndefined();
  });

  it('passes arrival and departure form constraints to the deterministic trip generator', async () => {
    await graph.invoke(
      {
        messages: [new HumanMessage('성수에서 카페와 저녁 식사 일정 만들어줘')],
        locale: 'ko',
        formTripContext: {
          arrivalDate: '2026-09-01',
          arrivalTime: '14:30',
          departureDate: '2026-09-04',
          departureTime: '11:00',
          hotel: '명동 호텔',
        },
      },
      { configurable: { thread_id: 'thread-arrival-departure' } },
    );

    expect(mockTripsService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        travelDate: '2026-09-01',
        startDate: '2026-09-01',
        endDate: '2026-09-04',
        startTime: '14:30',
        endTime: '11:00',
        hotel: '명동 호텔',
      }),
    );
  });

  it('pauses at request_approval node for trip modification and does NOT call patchStops before resume', async () => {
    const threadId = 'thread-mod-pause';
    const config = { configurable: { thread_id: threadId } };

    const result: any = await graph.invoke(
      {
        messages: [new HumanMessage('1번째 이상의집 빼줘')],
        currentTripId: 'trip-100',
        locale: 'ko',
      },
      config,
    );

    expect(result.status).toBe('awaiting_confirmation');
    expect(result.pendingAction).toBeDefined();
    expect(result.pendingAction.action).toBe('remove');
    expect(result.pendingAction.targetStop.placeName).toBe('이상의집');
    expect(mockTripsService.patchStops).not.toHaveBeenCalled();

    // Verify Checkpoint state does NOT contain any secret tokens
    const snapshot = await graph.getState(config);
    expect(snapshot.values.modification?.editToken).toBeUndefined();
  });

  it('keeps only the requested category in replacement alternatives', async () => {
    const cafePlace = {
      ...samplePlace2,
      id: 'p-cafe-current',
      name: '현재 카페',
      category: 'cafe',
    } as unknown as Place;
    const cafeAlternative = {
      ...samplePlace3,
      id: 'p-cafe-alt',
      name: '대체 카페',
      category: 'cafe',
    } as unknown as Place;
    const restaurantAlternative = {
      ...samplePlace3,
      id: 'p-food-alt',
      name: '대체 곱창집',
      category: '곱창',
    } as unknown as Place;
    mockTripsRepo.findOne.mockResolvedValue({
      id: 'trip-cafe',
      stops: [
        { id: 'stop-1', order: 1, placeId: 'p-1', place: samplePlace1 },
        { id: 'stop-cafe', order: 2, placeId: cafePlace.id, place: cafePlace },
      ],
    });
    mockPlacesRepo
      .createQueryBuilder()
      .getMany.mockResolvedValue([restaurantAlternative, cafeAlternative]);

    const result: any = await graph.invoke(
      {
        messages: [new HumanMessage('2번째 장소를 더 조용한 카페로 바꿔줘')],
        currentTripId: 'trip-cafe',
        locale: 'ko',
      },
      { configurable: { thread_id: 'thread-category-filter' } },
    );

    expect(result.status).toBe('awaiting_confirmation');
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0]).toMatchObject({ placeId: 'p-cafe-alt', category: 'cafe' });
    expect(result.pendingAction.warnings).toContain(
      '조용한 분위기는 현재 공식 장소 데이터로 검증할 수 없어 카테고리와 거리만 반영했습니다.',
    );
  });

  it('resumes from interrupt with reject decision and leaves DB untouched', async () => {
    const threadId = 'thread-mod-reject';
    const config = { configurable: { thread_id: threadId } };

    // 1. Initial invoke -> pauses at interrupt
    await graph.invoke(
      {
        messages: [new HumanMessage('1번째 이상의집 빼줘')],
        currentTripId: 'trip-100',
        locale: 'ko',
      },
      config,
    );

    expect(mockTripsService.patchStops).not.toHaveBeenCalled();

    // 2. Resume with reject
    const resumeResult: any = await (graph as any).invoke(
      new Command({ resume: { decision: 'reject' } }),
      config,
    );

    expect(resumeResult.status).toBe('rejected');
    expect(resumeResult.responseMessage).toContain('일정 수정을 취소했습니다');
    expect(mockTripsService.patchStops).not.toHaveBeenCalled();
  });

  it('resumes with approve decision and valid editToken passed via runtime config', async () => {
    const threadId = 'thread-mod-approve-valid';
    const config = {
      configurable: {
        thread_id: threadId,
        editToken: 'valid-secret-edit-token-123',
      },
    };

    // 1. Initial invoke -> pauses at interrupt
    const pausedState: any = await graph.invoke(
      {
        messages: [new HumanMessage('2번째 식당 다른 곳으로 교체해줘')],
        currentTripId: 'trip-100',
        locale: 'ko',
      },
      config,
    );

    expect(pausedState.status).toBe('awaiting_confirmation');
    expect(mockTripsService.patchStops).not.toHaveBeenCalled();

    const chosenAltId = pausedState.alternatives[0].placeId;

    // 2. Resume with approve and chosen alternative
    const resumedState: any = await (graph as any).invoke(
      new Command({
        resume: {
          decision: 'approve',
          chosenPlaceId: chosenAltId,
        },
      }),
      config,
    );

    expect(resumedState.status).toBe('completed');
    expect(resumedState.resultTripId).toBe('trip-100');
    expect(mockTripsService.patchStops).toHaveBeenCalledTimes(1);
    expect(mockTripsService.patchStops).toHaveBeenCalledWith(
      'trip-100',
      {
        action: 'replace',
        stopId: 'stop-2',
        newPlaceId: chosenAltId,
      },
      'valid-secret-edit-token-123',
    );
    expect(resumedState.modification.chosenPlaceId).toBe(chosenAltId);

    // Verify Checkpoint state does NOT contain editToken
    const snapshot = await graph.getState(config);
    expect(snapshot.values.modification?.editToken).toBeUndefined();
  });

  it('fails with TRIP_EDIT_FORBIDDEN when editToken is missing or invalid on resume', async () => {
    const threadId = 'thread-mod-approve-invalid-token';
    const config = {
      configurable: {
        thread_id: threadId,
        editToken: 'wrong-token',
      },
    };

    // 1. Initial invoke -> pauses at interrupt
    const pausedState: any = await graph.invoke(
      {
        messages: [new HumanMessage('2번째 식당 다른 곳으로 교체해줘')],
        currentTripId: 'trip-100',
        locale: 'ko',
      },
      config,
    );

    const chosenAltId = pausedState.alternatives[0].placeId;

    // 2. Resume with approve but wrong editToken
    const resumedState: any = await (graph as any).invoke(
      new Command({
        resume: {
          decision: 'approve',
          chosenPlaceId: chosenAltId,
        },
      }),
      config,
    );

    expect(resumedState.status).toBe('failed');
    expect(resumedState.errorCode).toBe('TRIP_EDIT_FORBIDDEN');
    expect(resumedState.responseMessage).toContain('권한이 없습니다');
  });

  it('does NOT fallback to 1st stop when target is ambiguous, returning clarify options instead', async () => {
    const threadId = 'thread-ambiguous-1';
    const config = { configurable: { thread_id: threadId } };

    const result: any = await graph.invoke(
      {
        messages: [new HumanMessage('존재하지않는장소 다른 곳으로 바꿔줘')],
        currentTripId: 'trip-100',
        locale: 'ko',
      },
      config,
    );

    expect(result.errorCode).toBe('TARGET_AMBIGUOUS');
    expect(result.responseMessage).toContain('어떤 장소를 변경할지 특정하지 못했습니다');
    expect(result.actionChips).toBeDefined();
    expect(result.modification?.targetStopId).toBeFalsy();
    expect(mockTripsService.patchStops).not.toHaveBeenCalled();
  });

  it('isolates state completely across different thread IDs', async () => {
    const thread1 = 'thread-iso-1';
    const thread2 = 'thread-iso-2';

    // Run thread 1 (QA)
    const res1: any = await graph.invoke(
      {
        messages: [new HumanMessage('이상의집 설명해줘')],
        locale: 'ko',
      },
      { configurable: { thread_id: thread1 } },
    );

    // Run thread 2 (New Trip)
    const res2: any = await graph.invoke(
      {
        messages: [new HumanMessage('서촌 한옥 산책 코스 짜줘')],
        locale: 'ko',
      },
      { configurable: { thread_id: thread2 } },
    );

    expect(res1.responseMessage).toContain('이상의집');
    expect(res2.resultTripId).toBe('trip-new');

    // Retrieve state of thread 1
    const snapshot1 = await graph.getState({ configurable: { thread_id: thread1 } });
    const snapshot2 = await graph.getState({ configurable: { thread_id: thread2 } });

    expect(snapshot1.values.responseMessage).toContain('이상의집');
    expect(snapshot2.values.resultTripId).toBe('trip-new');
  });
});
