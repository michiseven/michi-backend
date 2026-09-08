import { UnprocessableEntityException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  it('preserves additive generation recovery metadata in an HTTP error response', () => {
    const responses: Array<{ statusCode: number; body: unknown }> = [];
    const response = {
      status: (statusCode: number): { json: (body: unknown) => void } => ({
        json: (body: unknown): void => {
          responses.push({ statusCode, body });
        },
      }),
    };
    const http = { getResponse: (): typeof response => response };
    const host = {
      switchToHttp: (): typeof http => http,
    } as unknown as ArgumentsHost;

    new ApiExceptionFilter().catch(
      new UnprocessableEntityException({
        code: 'MEAL_CUISINE_NOT_FOUND',
        message: '식당을 찾지 못했습니다.',
        recovery: {
          reason: 'meal_cuisine_unavailable',
          actions: [{ id: 'meal_cuisine', requestPatch: { relaxations: ['meal_cuisine'] } }],
        },
      }),
      host,
    );

    expect(responses).toHaveLength(1);
    expect(responses[0]?.statusCode).toBe(422);
    expect(responses[0]?.body).toMatchObject({
      code: 'MEAL_CUISINE_NOT_FOUND',
      recovery: { reason: 'meal_cuisine_unavailable' },
    });
  });
});
