import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly clients = new Map<string, RateLimitRecord>();
  private readonly maxRequests = 15; // Max 15 generation requests per minute
  private readonly windowMs = 60_000; // 1 minute window

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const clientIp =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.socket.remoteAddress ||
      'anonymous';

    const now = Date.now();
    const record = this.clients.get(clientIp);

    if (!record || now > record.resetAt) {
      this.clients.set(clientIp, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (record.count >= this.maxRequests) {
      const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please wait before generating another itinerary.',
          retryAfter: retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    record.count += 1;
    return true;
  }
}
