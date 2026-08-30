import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LogFriendsService } from './log-friends.service';

describe('LogFriendsService', () => {
  let service: LogFriendsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogFriendsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'LOG_FRIENDS_INGEST_URL') return 'http://localhost:8080/ingest';
              if (key === 'LOG_FRIENDS_WORKER_ID') return 'michi-backend-test';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LogFriendsService>(LogFriendsService);
  });

  afterEach(async () => {
    await service.onApplicationShutdown();
  });

  it('initializes Node client and sets global client on module init', () => {
    service.onModuleInit();
    const client = service.getClient();
    expect(client).toBeDefined();
    expect(client?.['config'].workerId).toBe('michi-backend-test');
  });

  it('handles track calls safely with valid camelCase event name', () => {
    service.onModuleInit();
    const result = service.track('testEvent', { key: 'value' });
    expect(result).toBe(true);
  });

  it('reports discovered events on application bootstrap without crashing', async () => {
    service.onModuleInit();
    await expect(service.onApplicationBootstrap()).resolves.not.toThrow();
  });
});
