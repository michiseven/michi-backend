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
});
