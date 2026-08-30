import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Receipt, ReceiptItem, Visit } from '../database/entities';
import { DeterministicReceiptPlaceMatcher } from './deterministic-receipt-place-matcher';
import { MockReceiptExtractor } from './mock-receipt.extractor';
import { RECEIPT_EXTRACTOR } from './receipt-extractor';

@Module({
  imports: [TypeOrmModule.forFeature([Receipt, ReceiptItem, Visit])],
  providers: [
    MockReceiptExtractor,
    DeterministicReceiptPlaceMatcher,
    { provide: RECEIPT_EXTRACTOR, useExisting: MockReceiptExtractor },
  ],
  exports: [RECEIPT_EXTRACTOR, DeterministicReceiptPlaceMatcher],
})
export class ReceiptsModule {}
