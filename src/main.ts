import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix(config.getOrThrow<string>('API_PREFIX'));
  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN')?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors): BadRequestException =>
        new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: errors.map((error) => ({
            field: error.property,
            constraints: error.constraints ?? {},
          })),
        }),
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(config.getOrThrow<number>('PORT'));
}

void bootstrap();
