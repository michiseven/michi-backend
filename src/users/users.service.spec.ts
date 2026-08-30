import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RefreshToken, User, UserSavedTrip } from '../database/entities';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let users: User[] = [];
  let savedTrips: UserSavedTrip[] = [];
  let refreshTokens: RefreshToken[] = [];

  const mockUsersRepo = {
    create: jest.fn((dto: Partial<User>) => {
      const u = new User();
      Object.assign(u, {
        id: 'user-uuid-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
        ...dto,
      });
      return u;
    }),
    save: jest.fn((user: User) => {
      const idx = users.findIndex((u) => u.id === user.id);
      if (idx >= 0) {
        users[idx] = user;
      } else {
        users.push(user);
      }
      return Promise.resolve(user);
    }),
    findOne: jest.fn(({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email) return Promise.resolve(users.find((u) => u.email === where.email) ?? null);
      if (where.id) return Promise.resolve(users.find((u) => u.id === where.id) ?? null);
      return Promise.resolve(null);
    }),
  };

  const mockSavedTripsRepo = {
    create: jest.fn((dto: Partial<UserSavedTrip>) => {
      const st = new UserSavedTrip();
      Object.assign(st, {
        id: 'saved-uuid-1',
        savedAt: new Date(),
        ...dto,
      });
      return st;
    }),
    save: jest.fn((st: UserSavedTrip) => {
      const idx = savedTrips.findIndex((s) => s.id === st.id);
      if (idx >= 0) {
        savedTrips[idx] = st;
      } else {
        savedTrips.push(st);
      }
      return Promise.resolve(st);
    }),
    findOne: jest.fn(({ where }: { where: { userId?: string; tripId?: string; id?: string } }) => {
      const found =
        savedTrips.find((s) => {
          if (where.id && s.id !== where.id) return false;
          if (where.userId && s.userId !== where.userId) return false;
          if (where.tripId && s.tripId !== where.tripId) return false;
          return true;
        }) ?? null;
      return Promise.resolve(found);
    }),
    findAndCount: jest.fn(() => {
      return Promise.resolve([savedTrips, savedTrips.length] as [UserSavedTrip[], number]);
    }),
    remove: jest.fn((st: UserSavedTrip) => {
      savedTrips = savedTrips.filter((s) => s.id !== st.id);
      return Promise.resolve(st);
    }),
  };

  const mockRefreshTokensRepo = {
    create: jest.fn((dto: Partial<RefreshToken>) => {
      const rt = new RefreshToken();
      Object.assign(rt, {
        id: 'rt-uuid-1',
        createdAt: new Date(),
        revokedAt: null,
        ...dto,
      });
      return rt;
    }),
    save: jest.fn((rt: RefreshToken) => {
      refreshTokens.push(rt);
      return Promise.resolve(rt);
    }),
    findOne: jest.fn(({ where }: { where: { tokenHash: string } }) => {
      const found = refreshTokens.find((r) => r.tokenHash === where.tokenHash);
      if (!found) return Promise.resolve(null);
      const user = users.find((u) => u.id === found.userId);
      return Promise.resolve({ ...found, user: user! });
    }),
    update: jest.fn((criteria: string | { tokenHash?: string }, update: Partial<RefreshToken>) => {
      if (typeof criteria === 'string') {
        const item = refreshTokens.find((r) => r.id === criteria);
        if (item) Object.assign(item, update);
      } else if (criteria.tokenHash) {
        const item = refreshTokens.find((r) => r.tokenHash === criteria.tokenHash);
        if (item) Object.assign(item, update);
      }
      return Promise.resolve({ affected: 1 });
    }),
    createQueryBuilder: jest.fn(() => {
      let targetId: string | undefined;
      let targetUserId: string | undefined;
      let updateValues: Partial<RefreshToken> = {};
      const builder = {} as {
        update: jest.Mock;
        set: jest.Mock;
        where: jest.Mock;
        andWhere: jest.Mock;
        execute: jest.Mock;
      };
      builder.update = jest.fn(() => builder);
      builder.set = jest.fn((values: Partial<RefreshToken>) => {
        updateValues = values;
        return builder;
      });
      builder.where = jest.fn((_query: string, parameters?: { id?: string; userId?: string }) => {
        targetId = parameters?.id;
        targetUserId = parameters?.userId;
        return builder;
      });
      builder.andWhere = jest.fn(() => builder);
      builder.execute = jest.fn(() => {
        if (targetId) {
          const item = refreshTokens.find((token) => token.id === targetId);
          if (!item || item.revokedAt || item.expiresAt <= new Date()) {
            return { affected: 0 };
          }
          Object.assign(item, updateValues);
          return { affected: 1 };
        }

        const activeTokens = refreshTokens.filter(
          (token) => token.userId === targetUserId && !token.revokedAt,
        );
        activeTokens.forEach((token) => Object.assign(token, updateValues));
        return { affected: activeTokens.length };
      });
      return builder;
    }),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_SECRET') return 'test-jwt-secret-key-32charslong!';
      return null;
    }),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_SECRET') return 'test-jwt-secret-key-32charslong!';
      throw new Error(`Config ${key} not found`);
    }),
  };

  beforeEach(async () => {
    users = [];
    savedTrips = [];
    refreshTokens = [];
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
        { provide: getRepositoryToken(UserSavedTrip), useValue: mockSavedTripsRepo },
        { provide: getRepositoryToken(RefreshToken), useValue: mockRefreshTokensRepo },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('register & login', () => {
    it('should register a new user and return tokens', async () => {
      const result = await service.register({
        displayName: '田中太郎',
        email: 'tanaka@example.com',
        password: 'Password123!',
        locale: 'ja',
      });

      expect(result.user.email).toBe('tanaka@example.com');
      expect(result.user.displayName).toBe('田中太郎');
      expect(result.user.locale).toBe('ja');
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
    });

    it('should throw ConflictException if email already registered', async () => {
      await service.register({
        displayName: '田中太郎',
        email: 'tanaka@example.com',
        password: 'Password123!',
      });

      await expect(
        service.register({
          displayName: '田中二郎',
          email: 'tanaka@example.com',
          password: 'AnotherPassword1!',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should login with correct credentials', async () => {
      await service.register({
        displayName: '田中太郎',
        email: 'tanaka@example.com',
        password: 'Password123!',
      });

      const loginResult = await service.login({
        email: 'tanaka@example.com',
        password: 'Password123!',
      });

      expect(loginResult.user.email).toBe('tanaka@example.com');
      expect(loginResult.tokens.accessToken).toBeDefined();
    });

    it('should throw UnauthorizedException on wrong password', async () => {
      await service.register({
        displayName: '田中太郎',
        email: 'tanaka@example.com',
        password: 'Password123!',
      });

      await expect(
        service.login({
          email: 'tanaka@example.com',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh token rotation & logout', () => {
    it('should rotate refresh token and reject revoked old token', async () => {
      const registered = await service.register({
        displayName: '田中太郎',
        email: 'tanaka@example.com',
        password: 'Password123!',
      });

      const oldRefreshToken = registered.tokens.refreshToken;
      const refreshed = await service.refreshTokens(oldRefreshToken);

      expect(refreshed.tokens.accessToken).toBeDefined();
      expect(refreshed.tokens.refreshToken).toBeDefined();
      expect(refreshed.tokens.refreshToken).not.toBe(oldRefreshToken);

      // Attempting to reuse old token must throw UnauthorizedException
      await expect(service.refreshTokens(oldRefreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('should allow only one winner when the same refresh token is rotated concurrently', async () => {
      const registered = await service.register({
        displayName: '田中太郎',
        email: 'tanaka@example.com',
        password: 'Password123!',
      });

      const results = await Promise.allSettled([
        service.refreshTokens(registered.tokens.refreshToken),
        service.refreshTokens(registered.tokens.refreshToken),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(UnauthorizedException);
    });

    it('should revoke token on logout', async () => {
      const registered = await service.register({
        displayName: '田中太郎',
        email: 'tanaka@example.com',
        password: 'Password123!',
      });

      await service.logout(registered.tokens.refreshToken);
      await expect(service.refreshTokens(registered.tokens.refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('saved trips management', () => {
    it('should save trip snapshot and retrieve saved trips', async () => {
      await service.register({
        displayName: '田中太郎',
        email: 'tanaka@example.com',
        password: 'Password123!',
      });
      const user = users[0]!;

      const saved = await service.saveTrip(user, {
        tripId: 'c1b4a621-e072-4d1a-85b3-85f838271032',
        title: '聖水 カフェ巡り',
        travelDate: '2026-09-01',
        stopsCount: 4,
        estimatedTotalCost: 75000,
        memo: '行きたいカフェメモ',
      });

      expect(saved.title).toBe('聖水 カフェ巡り');
      expect(saved.stopsCount).toBe(4);

      const list = await service.getSavedTrips(user);
      expect(list.total).toBe(1);
      expect(list.items[0]?.title).toBe('聖水 カフェ巡り');
    });
  });
});
