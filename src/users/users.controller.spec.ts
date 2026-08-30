import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { User } from '../database/entities';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUser: User = {
    id: 'u-1',
    displayName: 'テストユーザー',
    email: 'user@test.com',
    passwordHash: 'hash',
    locale: 'ja',
    isActive: true,
    savedTrips: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createMockResponse = (): {
    res: Response;
    cookieMock: jest.Mock;
    clearCookieMock: jest.Mock;
  } => {
    const cookieMock = jest.fn().mockReturnThis();
    const clearCookieMock = jest.fn().mockReturnThis();
    const res = {
      cookie: cookieMock,
      clearCookie: clearCookieMock,
    } as unknown as Response;
    return { res, cookieMock, clearCookieMock };
  };

  const createMockRequest = (cookieHeader?: string): Request => {
    return {
      headers: {
        cookie: cookieHeader,
      },
    } as unknown as Request;
  };

  const mockUsersService = {
    register: jest.fn().mockResolvedValue({
      user: {
        id: 'u-1',
        displayName: 'テストユーザー',
        email: 'user@test.com',
        locale: 'ja',
        createdAt: new Date(),
      },
      tokens: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
      },
    }),
    login: jest.fn().mockResolvedValue({
      user: {
        id: 'u-1',
        displayName: 'テストユーザー',
        email: 'user@test.com',
        locale: 'ja',
        createdAt: new Date(),
      },
      tokens: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
      },
    }),
    refreshTokens: jest.fn().mockResolvedValue({
      user: {
        id: 'u-1',
        displayName: 'テストユーザー',
        email: 'user@test.com',
        locale: 'ja',
        createdAt: new Date(),
      },
      tokens: {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
      },
    }),
    logout: jest.fn().mockResolvedValue(undefined),
    logoutAll: jest.fn().mockResolvedValue(undefined),
    getProfile: jest.fn((u: User) => ({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      locale: u.locale,
      createdAt: u.createdAt,
    })),
    updateProfile: jest.fn().mockResolvedValue({
      id: 'u-1',
      displayName: '更新ユーザー',
      email: 'user@test.com',
      locale: 'ko',
      createdAt: new Date(),
    }),
    changePassword: jest.fn().mockResolvedValue(undefined),
    withdraw: jest.fn().mockResolvedValue(undefined),
    saveTrip: jest.fn().mockResolvedValue({
      id: 'st-1',
      userId: 'u-1',
      tripId: 'c1b4a621-e072-4d1a-85b3-85f838271032',
      title: 'テスト旅程',
    }),
    getSavedTrips: jest.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    }),
    getSavedTrip: jest.fn().mockResolvedValue({
      id: 'st-1',
      userId: 'u-1',
      tripId: 'c1b4a621-e072-4d1a-85b3-85f838271032',
      title: 'テスト旅程',
    }),
    updateSavedTripMemo: jest.fn().mockResolvedValue({
      id: 'st-1',
      memo: '更新メモ',
    }),
    removeSavedTrip: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'AUTH_COOKIE_SECURE') return false;
      if (key === 'AUTH_COOKIE_SAME_SITE') return 'lax';
      if (key === 'AUTH_COOKIE_PATH') return '/api/auth';
      return null;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should register, set HttpOnly cookie and return accessToken without refreshToken in json', async () => {
    const { res, cookieMock } = createMockResponse();
    const result = await controller.register(
      {
        displayName: 'テストユーザー',
        email: 'user@test.com',
        password: 'password123!',
      },
      res,
    );

    expect(result.user.email).toBe('user@test.com');
    expect(result.accessToken).toBe('access-token');
    expect((result as unknown as Record<string, unknown>).refreshToken).toBeUndefined();
    expect(cookieMock).toHaveBeenCalledWith(
      'refreshToken',
      'refresh-token',
      expect.objectContaining({
        httpOnly: true,
        path: '/api/auth',
      }),
    );
  });

  it('should login, set HttpOnly cookie and return accessToken without refreshToken in json', async () => {
    const { res, cookieMock } = createMockResponse();
    const result = await controller.login(
      {
        email: 'user@test.com',
        password: 'password123!',
      },
      res,
    );

    expect(result.accessToken).toBe('access-token');
    expect((result as unknown as Record<string, unknown>).refreshToken).toBeUndefined();
    expect(cookieMock).toHaveBeenCalledWith(
      'refreshToken',
      'refresh-token',
      expect.objectContaining({
        httpOnly: true,
        path: '/api/auth',
      }),
    );
  });

  it('should refresh tokens from HttpOnly cookie and rotate cookie', async () => {
    const req = createMockRequest('refreshToken=old-cookie-token');
    const { res, cookieMock } = createMockResponse();

    const result = await controller.refresh(req, res);

    expect(result.accessToken).toBe('new-access-token');
    expect((result as unknown as Record<string, unknown>).refreshToken).toBeUndefined();
    expect(mockUsersService.refreshTokens).toHaveBeenCalledWith('old-cookie-token');
    expect(cookieMock).toHaveBeenCalledWith(
      'refreshToken',
      'new-refresh-token',
      expect.objectContaining({
        httpOnly: true,
        path: '/api/auth',
      }),
    );
  });

  it('should logout and clear HttpOnly cookie', async () => {
    const req = createMockRequest('refreshToken=active-token');
    const { res, clearCookieMock } = createMockResponse();

    await controller.logout(req, res);

    expect(mockUsersService.logout).toHaveBeenCalledWith('active-token');
    expect(clearCookieMock).toHaveBeenCalledWith(
      'refreshToken',
      expect.objectContaining({
        path: '/api/auth',
      }),
    );
  });

  it('should get current user profile', () => {
    const res = controller.getMe(mockUser);
    expect(res.displayName).toBe('テストユーザー');
  });

  it('should save trip for current user', async () => {
    const res = await controller.saveTrip(mockUser, {
      tripId: 'c1b4a621-e072-4d1a-85b3-85f838271032',
      title: 'テスト旅程',
    });
    expect(res.title).toBe('テスト旅程');
  });
});
