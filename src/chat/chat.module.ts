import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Place, Trip, TripStop, ChatThread, User } from '../database/entities';
import { TripsModule } from '../trips/trips.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { PlaceDetailsModule } from '../place-details/place-details.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Place, Trip, TripStop, ChatThread, User]),
    TripsModule,
    PlaceDetailsModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
