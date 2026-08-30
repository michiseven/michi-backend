import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import dataSource from '../../database/data-source';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: false,
        migrations: dataSource.options.migrations,
        migrationsRun: config.get<string>('NODE_ENV') !== 'test',
        ssl: config.get<string>('DATABASE_SSL') === 'true' ? { rejectUnauthorized: false } : false,
      }),
    }),
  ],
})
export class DatabaseModule {}
