import { MockReceiptExtractor } from './mock-receipt.extractor';
import type { ReceiptExtractor } from './receipt-extractor';
import { redactSensitiveOcr } from './sensitive-ocr-redactor';

function assertExtractorContract(result: Awaited<ReturnType<ReceiptExtractor['extract']>>): void {
  expect(result.providerMode).toBe('mock');
  expect(result.synthetic).toBe(true);
  expect(result.merchantName).toContain('[MOCK]');
  expect(result.currency).toBe('KRW');
  expect(result.items[0]).toEqual(
    expect.objectContaining({
      lineNumber: 1,
      itemName: expect.any(String) as string,
    }),
  );
  expect(result.warnings).toEqual(expect.any(Array));
}

describe('MockReceiptExtractor', () => {
  it('implements the ReceiptExtractor contract without echoing sensitive OCR input', async () => {
    const extractor: ReceiptExtractor = new MockReceiptExtractor();
    const document = redactSensitiveOcr(
      '카드번호 4111-1111-1111-1111\n전화 010-1234-5678\nmerchant fixture',
    );

    const result = await extractor.extract({ document, locale: 'ja-JP' });

    assertExtractorContract(result);
    expect(JSON.stringify(result)).not.toContain('4111-1111-1111-1111');
    expect(JSON.stringify(result)).not.toContain('010-1234-5678');
  });
});
