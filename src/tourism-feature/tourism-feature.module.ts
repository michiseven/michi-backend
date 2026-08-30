import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TourismMetric } from '../database/entities';
import { TourismFeatureService } from './tourism-feature.service';

@Module({
  imports: [TypeOrmModule.forFeature([TourismMetric])],
  providers: [TourismFeatureService],
  exports: [TourismFeatureService],
})
export class TourismFeatureModule {}
