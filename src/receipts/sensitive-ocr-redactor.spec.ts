import { redactSensitiveOcr } from './sensitive-ocr-redactor';

describe('redactSensitiveOcr', () => {
  it('removes card, phone, labeled name, and credential-like values before extraction', () => {
    const fakeOpenAiKey = ['sk', 'proj', 'abcdefghijklmnop'].join('-');
    const result = redactSensitiveOcr(`상호: 성수카페
카드번호: 4111-1111-1111-1111
전화: 010-1234-5678
お名前: 山田太郎
키 샘플 ${fakeOpenAiKey}
Authorization: Bearer abcdefghijklmnopqrstuvwxyz`);

    expect(result.kind).toBe('redacted-ocr');
    expect(result.text).toContain('상호: 성수카페');
    expect(result.text).not.toContain('4111-1111-1111-1111');
    expect(result.text).not.toContain('010-1234-5678');
    expect(result.text).not.toContain('山田太郎');
    expect(result.text).not.toContain(fakeOpenAiKey);
    expect(result.text).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(result.redactionCounts).toEqual({
      card: 1,
      phone: 1,
      name: 1,
      credential: 2,
    });
  });

  it('does not retain the original input in its result shape', () => {
    const secret = 'password=do-not-store-this';
    const result = redactSensitiveOcr(secret);

    expect(Object.keys(result).sort()).toEqual(['kind', 'redactionCounts', 'text']);
    expect(JSON.stringify(result)).not.toContain('do-not-store-this');
  });
});
