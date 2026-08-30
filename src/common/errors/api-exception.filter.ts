import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

interface ErrorBody {
  code?: unknown;
  details?: unknown;
  message?: unknown;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const body: ErrorBody = typeof raw === 'object' && raw !== null ? raw : {};

    if (!(exception instanceof HttpException)) {
      this.logger.error(exception);
    }

    response.status(statusCode).json({
      statusCode,
      code:
        typeof body.code === 'string'
          ? body.code
          : statusCode === 400
            ? 'VALIDATION_ERROR'
            : statusCode === 500
              ? 'INTERNAL_ERROR'
              : 'HTTP_ERROR',
      message:
        typeof body.message === 'string'
          ? body.message
          : Array.isArray(body.message)
            ? 'Request validation failed'
            : exception instanceof Error
              ? exception.message
              : 'Unexpected error',
      ...(body.details !== undefined
        ? { details: body.details }
        : Array.isArray(body.message)
          ? { details: body.message }
          : {}),
    });
  }
}
