import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './common/database/database.module';
import { validateEnvironment } from './common/config/env.validation';
import { HealthModule } from './health/health.module';
import { PreferencesModule } from './preferences/preferences.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { TripsModule } from './trips/trips.module';
import { TourismDataModule } from './tourism-data/tourism-data.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { TransitModule } from './transit/transit.module';
import { UsersModule } from './users/users.module';
import { ChatModule } from './chat/chat.module';
import { LogFriendsModule } from './common/telemetry/log-friends.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../.env'],
      validate: validateEnvironment,
    }),
    LogFriendsModule,
    DatabaseModule,
    PreferencesModule,
    HealthModule,
    TripsModule,
    ReceiptsModule,
    TourismDataModule,
    EvaluationModule,
    TransitModule,
    UsersModule,
    ChatModule,
  ],
})
export class AppModule {}
