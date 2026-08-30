import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransitStation } from '../database/entities';
import { TransitStationService } from './transit-station.service';

@Module({
  imports: [TypeOrmModule.forFeature([TransitStation])],
  providers: [TransitStationService],
  exports: [TransitStationService],
})
export class TransitModule {}
