import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;

  beforeEach(() => {
    guard = new RateLimitGuard();
  });

  function createMockContext(ip = '127.0.0.1'): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-forwarded-for': ip },
          socket: { remoteAddress: ip },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows requests within limit', () => {
    const ctx = createMockContext('1.2.3.4');
    for (let i = 0; i < 15; i++) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('throws 429 Too Many Requests when rate limit is exceeded', () => {
    const ctx = createMockContext('5.6.7.8');
    for (let i = 0; i < 15; i++) {
      guard.canActivate(ctx);
    }

    try {
      guard.canActivate(ctx);
      fail('Expected HttpException to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('tracks distinct IP addresses independently', () => {
    const ctxA = createMockContext('10.0.0.1');
    const ctxB = createMockContext('10.0.0.2');

    for (let i = 0; i < 15; i++) {
      expect(guard.canActivate(ctxA)).toBe(true);
    }
    expect(guard.canActivate(ctxB)).toBe(true);
  });
});
