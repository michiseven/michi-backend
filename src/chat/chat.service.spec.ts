/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatThread, Place, Trip } from '../database/entities';
import { TripsService } from '../trips/trips.service';
import { PlaceDetailEnrichmentService } from '../place-details/place-detail-enrichment.service';
import type { ChatState } from './chat-state';

describe('ChatService', () => {
  let service: ChatService;
  let mockPlacesRepo: any;
  let mockTripsRepo: any;
  let mockThreadsRepo: any;
  let mockTripsService: any;
  let mockConfigService: any;

  const threadsDb = new Map<string, ChatThread>();

  beforeEach(async () => {
    threadsDb.clear();

    mockPlacesRepo = {
      createQueryBuilder: jest.fn<any>().mockReturnValue({
        where: jest.fn<any>().mockReturnThis(),
        andWhere: jest.fn<any>().mockReturnThis(),
        take: jest.fn<any>().mockReturnThis(),
        getOne: jest.fn<any>().mockResolvedValue({ id: 'p-1', name: '이상의집' }),
        getMany: jest.fn<any>().mockResolvedValue([]),
      }),
      findOne: jest.fn<any>().mockResolvedValue({ id: 'p-1', name: '이상의집' }),
    };

    mockTripsRepo = {
      findOne: jest.fn<any>().mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          editToken: where.id === 'trip-gen-1' ? 'generated-edit-token-123' : null,
          stops: [{ id: 'stop-1', order: 1, placeId: 'p-1', place: { name: '이상의집' } }],
        }),
      ),
    };

    mockThreadsRepo = {
      create: jest.fn<any>().mockImplementation(
        (dto: Partial<ChatThread>): ChatThread =>
          ({
            id: `thread-${Date.now()}-${Math.random()}`,
            ...dto,
            createdAt: new Date(),
            updatedAt: new Date(),
          }) as ChatThread,
      ),
      save: jest.fn<any>().mockImplementation((entity: ChatThread) => {
        threadsDb.set(entity.id, entity);
        return Promise.resolve(entity);
      }),
      findOne: jest.fn<any>().mockImplementation(({ where }: { where: { id: string } }) => {
        return Promise.resolve(threadsDb.get(where.id) || null);
      }),
    };

    mockTripsService = {
      generate: jest.fn<any>().mockResolvedValue({
        trip: { id: 'trip-gen-1' },
        editToken: 'generated-edit-token-123',
      }),
      patchStops: jest.fn<any>().mockResolvedValue({ trip: { id: 'trip-1' } }),
    };

    mockConfigService = {
      get: jest.fn((key: unknown) => {
        if (key === 'CHAT_CHECKPOINTER_MODE') return 'memory';
        if (key === 'OPENAI_API_KEY') return undefined;
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: getRepositoryToken(Place), useValue: mockPlacesRepo },
        { provide: getRepositoryToken(Trip), useValue: mockTripsRepo },
        { provide: getRepositoryToken(ChatThread), useValue: mockThreadsRepo },
        { provide: TripsService, useValue: mockTripsService },
        {
          provide: PlaceDetailEnrichmentService,
          useValue: { enrich: jest.fn<any>().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    await service.onModuleInit();
  });

  it('creates unique thread with threadSecret and stores ownership', async () => {
    const res = await service.createThread({ locale: 'ko' }, 'user-abc');
    expect(res.threadId).toBeDefined();
    expect(res.threadSecret).toBeDefined();
    expect(res.threadSecret.length).toBe(64);

    const thread = threadsDb.get(res.threadId);
    expect(thread).toBeDefined();
    expect(thread?.userId).toBe('user-abc');
    expect(thread?.threadSecret).toBe(res.threadSecret);
  });

  it('allows access to thread with valid threadSecret or matching userId', async () => {
    const thread = await service.createThread({ locale: 'ko' }, 'user-owner');

    // 1. Owner can access with userId
    const accessedByOwner = await service.validateThreadAccess(thread.threadId, {
      userId: 'user-owner',
    });
    expect(accessedByOwner.id).toBe(thread.threadId);

    // 2. Client with threadSecret can access
    const accessedBySecret = await service.validateThreadAccess(thread.threadId, {
      threadSecret: thread.threadSecret,
    });
    expect(accessedBySecret.id).toBe(thread.threadId);

    // 3. Different user without secret is FORBIDDEN
    await expect(
      service.validateThreadAccess(thread.threadId, { userId: 'user-attacker' }),
    ).rejects.toThrow(ForbiddenException);

    // 4. Anonymous caller without secret is FORBIDDEN
    await expect(service.validateThreadAccess(thread.threadId, {})).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws NotFoundException for non-existent thread', async () => {
    await expect(
      service.validateThreadAccess('non-existent-thread', { threadSecret: 'any' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('sends message with thread access validation and returns ChatResponseDto', async () => {
    const { threadId, threadSecret } = await service.createThread({ locale: 'ko' });
    const res = await service.sendMessage(
      threadId,
      {
        message: '이상의집이 뭐야?',
        locale: 'ko',
      },
      { threadSecret },
    );

    expect(res.threadId).toBe(threadId);
    expect(res.threadSecret).toBe(threadSecret);
    expect(res.status).toBe('completed');
    expect(res.responseMessage).toContain('이상의집');
  });

  it('carries Hongdae scope across a target chip without mutating before approval', async () => {
    const tripRepo = mockTripsRepo as { findOne: jest.Mock<() => Promise<unknown>> };
    const placeRepo = mockPlacesRepo as {
      createQueryBuilder: () => { getMany: jest.Mock<() => Promise<unknown[]>> };
    };
    const tripsService = mockTripsService as { patchStops: jest.Mock };
    tripRepo.findOne.mockResolvedValue({
      id: 'trip',
      stops: [
        {
          id: 's1',
          order: 1,
          placeId: 'p1',
          place: { name: '공덕로스터리', category: 'cafe', district: '마포구' },
        },
        {
          id: 's2',
          order: 2,
          placeId: 'p2',
          place: { name: '포멜로빈 공덕점', category: 'cafe', district: '마포구' },
        },
      ],
    });
    placeRepo.createQueryBuilder().getMany.mockResolvedValue([
      {
        id: 'hongdae',
        name: '홍대 커피',
        category: 'cafe',
        rawCategory: '음식점>카페',
        district: '마포구',
        location: { type: 'Point', coordinates: [126.924, 37.558] },
      },
      {
        id: 'gongdeok',
        name: '공덕 커피',
        category: 'cafe',
        rawCategory: '음식점>카페',
        district: '마포구',
        location: { type: 'Point', coordinates: [126.951, 37.544] },
      },
    ]);
    const { threadId, threadSecret } = await service.createThread({
      locale: 'ko',
      currentTripId: 'trip',
    });
    const first = await service.sendMessage(
      threadId,
      { message: '홍대입구역 도보 15분 이내 일반 카페로 바꿔줘. 스터디카페는 제외' },
      { threadSecret },
    );
    expect(first.errorCode).toBe('TARGET_AMBIGUOUS');
    const selected = await service.sendMessage(
      threadId,
      {
        message: '1번째 장소를 다른 곳으로 바꿔줘',
        mutationTarget: { stopId: 's1', stopOrder: 1, placeName: '공덕로스터리' },
      },
      { threadSecret },
    );
    expect(selected.status).toBe('awaiting_confirmation');
    expect(selected.alternatives?.map((p) => p.placeId)).toEqual(['hongdae']);
    const graph = (
      service as unknown as {
        graph: { getState: (config: unknown) => Promise<{ config: unknown; values: ChatState }> };
      }
    ).graph;
    const before = await graph.getState({ configurable: { thread_id: threadId } });
    const answer = await service.sendMessage(
      threadId,
      {
        message: 'この3店のうち、伝統茶を飲めると確認できた店はどこですか？',
        locale: 'ja',
      },
      { threadSecret },
    );
    expect(answer.status).toBe('awaiting_confirmation');
    expect(answer.responseMessage).toContain('伝統茶を提供する根拠は未確認');
    expect(answer.responseMessage).not.toContain('キャンセル');
    expect(answer.pendingAction).toEqual(selected.pendingAction);
    const after = await graph.getState({ configurable: { thread_id: threadId } });
    expect(after.config).toEqual(before.config);
    expect(after.values.pendingAction).toEqual(before.values.pendingAction);
    expect(tripsService.patchStops).not.toHaveBeenCalled();
    const rejected = await service.resumeThread(threadId, { decision: 'reject' }, { threadSecret });
    expect(rejected.status).toBe('rejected');
    expect(tripsService.patchStops).not.toHaveBeenCalled();
  });

  it('answers an active airport gap in explicitly requested Korean without re-generating', async () => {
    const tripRepo = mockTripsRepo as { findOne: jest.Mock<() => Promise<unknown>> };
    const tripsService = mockTripsService as { generate: jest.Mock; patchStops: jest.Mock };
    tripRepo.findOne.mockResolvedValue({
      id: 'trip',
      stops: [],
      preference: {
        originalText: '인천공항 18시 도착, 캐리어 보관 후 짐 회수',
        validatedJson: {},
      },
    });
    const { threadId, threadSecret } = await service.createThread({
      locale: 'ja',
      currentTripId: 'trip',
    });
    const result = await service.sendMessage(
      threadId,
      { locale: 'ja', message: '짐 회수와 공항 도착이 빠졌는데 어떻게 돼? 한국어로 답해줘' },
      { threadSecret },
    );
    expect(result.responseMessage).toContain('18:00');
    expect(result.responseMessage).toContain('짐 보관시설');
    expect(result.responseMessage).toContain('터미널');
    expect(result.pendingQuestion).toBeFalsy();
    expect(tripsService.generate).not.toHaveBeenCalled();
    expect(tripsService.patchStops).not.toHaveBeenCalled();
  });
  it('answers the exact Japanese question about three pending candidates, then approves exactly once', async () => {
    const tripRepo = mockTripsRepo as { findOne: jest.Mock<() => Promise<unknown>> };
    const placeRepo = mockPlacesRepo as {
      createQueryBuilder: () => { getMany: jest.Mock<() => Promise<unknown>> };
    };
    const tripsService = mockTripsService as { patchStops: jest.Mock };
    tripRepo.findOne.mockResolvedValue({
      id: 'trip',
      stops: [
        {
          id: 'stop-1',
          order: 1,
          placeId: 'old',
          place: { name: '크레마노', category: 'cafe', district: '종로구' },
        },
      ],
    });
    placeRepo.createQueryBuilder().getMany.mockResolvedValue([
      {
        id: 'camell',
        name: '카멜커피',
        category: 'cafe',
        rawCategory: '음식점>카페',
        district: '종로구',
      },
      { id: 'mk2', name: 'mk2', category: 'cafe', rawCategory: '음식점>카페', district: '종로구' },
      {
        id: 'aslike',
        name: '애즈라이크',
        category: 'cafe',
        rawCategory: '음식점>카페',
        district: '종로구',
      },
    ]);
    const { threadId, threadSecret } = await service.createThread({
      locale: 'ja',
      currentTripId: 'trip',
    });
    const first = await service.sendMessage(
      threadId,
      { message: '1번째 장소를 다른 카페로 바꿔줘' },
      { threadSecret },
    );
    expect(first.alternatives).toHaveLength(3);
    const answer = await service.sendMessage(
      threadId,
      { locale: 'ja', message: 'この3店のうち、伝統茶を飲めると確認できた店はどこですか？' },
      { threadSecret },
    );
    expect(answer.alternatives).toEqual(first.alternatives);
    expect(answer.responseMessage.match(/伝統茶を提供する根拠は未確認/gu)).toHaveLength(3);
    expect(answer.responseMessage).not.toContain('キャンセル');
    expect(tripsService.patchStops).not.toHaveBeenCalled();
    const approved = await service.resumeThread(
      threadId,
      { decision: 'approve', chosenPlaceId: first.alternatives![0]!.placeId },
      { threadSecret },
    );
    expect(approved.status).toBe('completed');
    expect(tripsService.patchStops).toHaveBeenCalledTimes(1);
    await service.resumeThread(
      threadId,
      { decision: 'approve', chosenPlaceId: first.alternatives![0]!.placeId },
      { threadSecret },
    );
    expect(tripsService.patchStops).toHaveBeenCalledTimes(1);
  });

  it('preserves distinct profile airports through the chat request into trip generation', async () => {
    const { threadId, threadSecret } = await service.createThread({ locale: 'ko' });

    await service.sendMessage(
      threadId,
      {
        message: '성수에서 카페와 저녁 식사 일정 만들어줘',
        locale: 'ko',
        mealCuisine: 'korean',
        profile: {
          arrivalDate: '2026-09-10',
          arrivalTime: '14:30',
          departureDate: '2026-09-12',
          departureTime: '11:00',
          arrivalAirport: 'ICN_T1',
          departureAirport: 'GMP_DOM',
          partySize: 3,
          hasLuggage: true,
        },
      },
      { threadSecret },
    );

    const tripsServiceMock = mockTripsService as { generate: jest.Mock };
    expect(tripsServiceMock.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        arrivalAirport: 'ICN_T1',
        departureAirport: 'GMP_DOM',
        partySize: 3,
        hasLuggage: true,
      }),
    );
  });

  it('retrieves thread state snapshot after execution with ownership check', async () => {
    const { threadId, threadSecret } = await service.createThread({ locale: 'ko' });
    await service.sendMessage(
      threadId,
      {
        message: '성수동 카페 일정 짜줘',
        locale: 'ko',
      },
      { threadSecret },
    );

    const state = await service.getThreadState(threadId, { threadSecret });
    expect(state).not.toBeNull();
    expect(state?.resultTripId).toBe('trip-gen-1');

    // Forbidden without secret
    await expect(service.getThreadState(threadId, {})).rejects.toThrow(ForbiddenException);
  });

  it('resets transient state between turns and keeps the generated trip as chat context', async () => {
    const { threadId, threadSecret } = await service.createThread({ locale: 'ko' });

    const created = await service.sendMessage(
      threadId,
      { message: '성수동 카페 일정 짜줘', locale: 'ko' },
      { threadSecret },
    );

    expect(created.resultTripId).toBe('trip-gen-1');
    expect(created.editToken).toBe('generated-edit-token-123');
    expect(threadsDb.get(threadId)?.tripId).toBe('trip-gen-1');

    const answered = await service.sendMessage(
      threadId,
      { message: '이상의집 영업시간과 가격 알려줘', locale: 'ko' },
      { threadSecret },
    );

    expect(answered.responseMessage).toContain('이상의집');
    expect(answered.responseMessage).not.toContain('맞춤 여행 일정이 완성되었습니다');
    expect(answered.resultTripId).toBeNull();

    const checkpoint = await service.getThreadState(threadId, { threadSecret });
    expect(JSON.stringify(checkpoint)).not.toContain('generated-edit-token-123');
  });

  it('keeps an example request separate from a prior trip and ignored form profile', async () => {
    const { threadId, threadSecret } = await service.createThread({ locale: 'ko' });
    await service.sendMessage(
      threadId,
      { message: '성수동 카페 일정 짜줘', locale: 'ko' },
      { threadSecret },
    );
    const tripsServiceMock = mockTripsService as { generate: jest.Mock };
    tripsServiceMock.generate.mockClear();

    await service.sendMessage(
      threadId,
      {
        message: '경복궁과 서촌 반나절 코스 짜줘',
        locale: 'ko',
        startFreshTrip: true,
        profilePolicy: 'ignore',
        profile: {
          arrivalDate: '2026-09-20',
          arrivalTime: '08:00',
          departureDate: '2026-09-22',
          departureTime: '22:00',
          hotel: { name: '이전 일정 호텔' },
        },
      },
      { threadSecret },
    );

    expect(tripsServiceMock.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '경복궁과 서촌 반나절 코스 짜줘',
        startDate: undefined,
        endDate: undefined,
        hotel: undefined,
      }),
    );
  });

  it('rejects a stale structured meal answer before intent classification or generation', async () => {
    const { threadId, threadSecret } = await service.createThread({ locale: 'ja' });
    const pending = await service.sendMessage(
      threadId,
      { message: '弘大でランチとカフェを楽しみたい', locale: 'ja' },
      { threadSecret },
    );

    expect(pending.pendingQuestion?.id).toBe('meal-choice-1');
    expect(pending.actionChips?.[0]).toMatchObject({
      questionId: 'meal-choice-1',
      optionId: 'korean',
    });
    const generate = (mockTripsService as { generate: jest.Mock }).generate;
    generate.mockClear();

    const stale = await service.sendMessage(
      threadId,
      {
        message: '한식으로 추천해줘',
        locale: 'ja',
        questionId: 'meal-choice-0',
        optionId: 'korean',
        expectedRevision: 1,
      },
      { threadSecret },
    );

    expect(stale.errorCode).toBe('STALE_QUESTION');
    expect(stale.responseMessage).toContain('古い質問');
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns the cached response for a duplicate requestId without generating twice', async () => {
    const { threadId, threadSecret } = await service.createThread({ locale: 'ko' });
    const generate = (mockTripsService as { generate: jest.Mock }).generate;
    const first = await service.sendMessage(
      threadId,
      { message: '성수동 카페 일정 짜줘', locale: 'ko', requestId: 'request-1' },
      { threadSecret },
    );
    await service.sendMessage(
      threadId,
      { message: '이상의집이 뭐야?', locale: 'ko', requestId: 'request-2' },
      { threadSecret },
    );
    generate.mockClear();

    const duplicate = await service.sendMessage(
      threadId,
      { message: '성수동 카페 일정 짜줘', locale: 'ko', requestId: 'request-1' },
      { threadSecret },
    );

    expect(duplicate.responseMessage).toBe(first.responseMessage);
    expect(duplicate.resultTripId).toBe(first.resultTripId);
    expect(generate).not.toHaveBeenCalled();
  });

  it('bounds the request cache to the most recent twenty entries', async () => {
    const { threadId, threadSecret } = await service.createThread({ locale: 'ko' });
    const generate = (mockTripsService as { generate: jest.Mock }).generate;
    await service.sendMessage(
      threadId,
      { message: '성수동 카페 일정 짜줘', locale: 'ko', requestId: 'request-0' },
      { threadSecret },
    );

    for (let index = 1; index <= 20; index += 1) {
      await service.sendMessage(
        threadId,
        { message: '이상의집이 뭐야?', locale: 'ko', requestId: `request-${index}` },
        { threadSecret },
      );
    }
    generate.mockClear();

    await service.sendMessage(
      threadId,
      { message: '성수동 카페 일정 짜줘', locale: 'ko', requestId: 'request-0' },
      { threadSecret },
    );

    expect(generate).toHaveBeenCalledTimes(1);
  });
});
