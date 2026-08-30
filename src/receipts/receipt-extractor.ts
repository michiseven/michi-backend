import type { ProviderMode } from '../common/config/env.validation';
import type { RedactedOcrDocument } from './sensitive-ocr-redactor';

export const RECEIPT_EXTRACTOR = Symbol('RECEIPT_EXTRACTOR');

export type ReceiptExtractionWarning =
  'merchant_missing' | 'purchase_date_missing' | 'purchase_time_missing' | 'total_amount_missing';

export interface ReceiptExtractionInput {
  document: RedactedOcrDocument;
  locale?: 'ja-JP' | 'ko-KR';
}

export interface ExtractedReceiptItem {
  lineNumber: number;
  itemName: string;
  quantity: number | null;
  unitPriceKrw: number | null;
  amountKrw: number | null;
}

export interface ReceiptExtractionResult {
  provider: string;
  providerMode: ProviderMode;
  synthetic: boolean;
  merchantName: string | null;
  merchantAddress: string | null;
  purchaseDate: string | null;
  purchaseTime: string | null;
  totalAmountKrw: number | null;
  currency: 'KRW';
  items: ExtractedReceiptItem[];
  warnings: ReceiptExtractionWarning[];
}

export interface ReceiptExtractor {
  readonly mode: ProviderMode;
  readonly name: string;
  extract(input: ReceiptExtractionInput): Promise<ReceiptExtractionResult>;
}
