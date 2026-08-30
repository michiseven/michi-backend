/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  let controller: ChatController;
  let mockChatService: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockChatService = {
      createThread: jest.fn<any>().mockResolvedValue({
        threadId: 'thread-123',
        threadSecret: 'secret-123',
      }),
      sendMessage: jest.fn<any>().mockResolvedValue({
        threadId: 'thread-123',
        threadSecret: 'secret-123',
        status: 'completed',
        responseMessage: '답변입니다',
      }),
      resumeThread: jest.fn<any>().mockResolvedValue({
        threadId: 'thread-123',
        threadSecret: 'secret-123',
        status: 'completed',
        responseMessage: '수정 완료되었습니다',
      }),
      getThreadState: jest.fn<any>().mockImplementation((id: any) => {
        if (id === 'thread-123') {
          return Promise.resolve({
            threadId: 'thread-123',
            threadSecret: 'secret-123',
            status: 'completed',
            responseMessage: '저장된 상태',
          });
        }
        return Promise.resolve(null);
      }),
    };

    mockConfigService = {
      get: jest.fn((key: unknown) => {
        if (key === 'JWT_ACCESS_SECRET') return 'test-jwt-secret-key-32-chars-long!';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: mockChatService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  it('POST /chat/threads creates a thread with threadSecret', async () => {
    const res = await controller.createThread({ locale: 'ko' });
    expect(res.threadId).toBe('thread-123');
    expect(res.threadSecret).toBe('secret-123');
    expect(mockChatService.createThread).toHaveBeenCalledWith({ locale: 'ko' }, null);
  });

  it('POST /chat/threads/:threadId/messages passes headers and dto to service', async () => {
    const mockReq = {
      headers: {
        'x-thread-secret': 'secret-123',
        'x-trip-edit-token': 'edit-token-123',
      },
    } as unknown as Request;

    const res = await controller.sendMessage(
      'thread-123',
      {
        message: '안녕하세요',
        locale: 'ko',
      },
      mockReq,
    );

    expect(res.status).toBe('completed');
    expect(mockChatService.sendMessage).toHaveBeenCalledWith(
      'thread-123',
      {
        message: '안녕하세요',
        locale: 'ko',
      },
      {
        userId: null,
        threadSecret: 'secret-123',
        editToken: 'edit-token-123',
      },
    );
  });

  it('POST /chat/threads/:threadId/resume passes editToken and threadSecret', async () => {
    const mockReq = {
      headers: {},
    } as unknown as Request;

    const res = await controller.resumeThread(
      'thread-123',
      {
        decision: 'approve',
        chosenPlaceId: 'p-1',
        threadSecret: 'secret-123',
        editToken: 'edit-token-abc',
      },
      mockReq,
    );

    expect(res.status).toBe('completed');
    expect(mockChatService.resumeThread).toHaveBeenCalledWith(
      'thread-123',
      {
        decision: 'approve',
        chosenPlaceId: 'p-1',
        threadSecret: 'secret-123',
        editToken: 'edit-token-abc',
      },
      {
        userId: null,
        threadSecret: 'secret-123',
        editToken: 'edit-token-abc',
      },
    );
  });

  it('GET /chat/threads/:threadId/state queries thread state with secret', async () => {
    const mockReq = {
      headers: {
        'x-thread-secret': 'secret-123',
      },
    } as unknown as Request;

    const res = await controller.getThreadState('thread-123', mockReq);
    expect(res.threadId).toBe('thread-123');
    expect(mockChatService.getThreadState).toHaveBeenCalledWith('thread-123', {
      userId: null,
      threadSecret: 'secret-123',
    });
  });
});
