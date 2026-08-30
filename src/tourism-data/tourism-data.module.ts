import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Place, TourismDataSource, TourismImportRun, TourismMetric } from '../database/entities';
import { KtoDataLabConcentrationProvider } from './kto-datalab-concentration.provider';
import { KtoDataLabConcentrationSyncService } from './kto-datalab-concentration-sync.service';
import { TourismDataImportService } from './tourism-data-import.service';

@Module({
  imports: [TypeOrmModule.forFeature([Place, TourismDataSource, TourismImportRun, TourismMetric])],
  providers: [
    TourismDataImportService,
    KtoDataLabConcentrationProvider,
    KtoDataLabConcentrationSyncService,
  ],
  exports: [
    TourismDataImportService,
    KtoDataLabConcentrationProvider,
    KtoDataLabConcentrationSyncService,
    TypeOrmModule,
  ],
})
export class TourismDataModule {}
