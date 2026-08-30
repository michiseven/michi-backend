import { Injectable } from '@nestjs/common';
import type {
  ReceiptExtractionInput,
  ReceiptExtractionResult,
  ReceiptExtractor,
} from './receipt-extractor';

@Injectable()
export class MockReceiptExtractor implements ReceiptExtractor {
  readonly mode = 'mock' as const;
  readonly name = 'mock-receipt-extractor';

  async extract(input: ReceiptExtractionInput): Promise<ReceiptExtractionResult> {
    if (input.document.kind !== 'redacted-ocr') {
      throw new Error('MockReceiptExtractor accepts redacted OCR documents only.');
    }

    return Promise.resolve({
      provider: this.name,
      providerMode: this.mode,
      synthetic: true,
      merchantName: '[MOCK] 성수 영수증 카페',
      merchantAddress: '서울특별시 성동구 성수동',
      purchaseDate: '2026-08-18',
      purchaseTime: '15:20',
      totalAmountKrw: 9_000,
      currency: 'KRW',
      items: [
        {
          lineNumber: 1,
          itemName: '[MOCK] 커피',
          quantity: 1,
          unitPriceKrw: 9_000,
          amountKrw: 9_000,
        },
      ],
      warnings: [],
    });
  }
}
