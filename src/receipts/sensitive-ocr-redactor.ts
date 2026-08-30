export type SensitiveOcrCategory = 'card' | 'phone' | 'name' | 'credential';

export interface RedactedOcrDocument {
  readonly kind: 'redacted-ocr';
  readonly text: string;
  readonly redactionCounts: Readonly<Record<SensitiveOcrCategory, number>>;
}

const PHONE_PATTERNS = [
  /(?<!\d)0(?:10|2|[3-6][1-5])[- .]?\d{3,4}[- .]?\d{4}(?!\d)/gu,
  /(?<!\d)\+?82[- .]?(?:10|2|[3-6][1-5])[- .]?\d{3,4}[- .]?\d{4}(?!\d)/gu,
  /(?<!\d)0(?:70|80|90)[- .]?\d{4}[- .]?\d{4}(?!\d)/gu,
  /(?<!\d)\+?81[- .]?(?:70|80|90)[- .]?\d{4}[- .]?\d{4}(?!\d)/gu,
];
const CARD_PATTERN = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/gu;
const LABELED_CREDENTIAL_PATTERN =
  /\b(?:(?:[a-z][a-z0-9]*[_-])*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)|api key|access token|refresh token|authorization)\b\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/giu;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gu;
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}/gu;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu;
const LABELED_NAME_PATTERN =
  /(?:^|\n)\s*(?:성명|이름|고객명|氏名|お名前|name|customer\s+name)\s*[:：]\s*[^\r\n]+/gimu;

function replaceAndCount(
  input: string,
  pattern: RegExp,
  category: SensitiveOcrCategory,
  counts: Record<SensitiveOcrCategory, number>,
): string {
  return input.replace(pattern, () => {
    counts[category] += 1;
    return `[REDACTED:${category.toUpperCase()}]`;
  });
}

export function redactSensitiveOcr(input: string): RedactedOcrDocument {
  const counts: Record<SensitiveOcrCategory, number> = {
    card: 0,
    phone: 0,
    name: 0,
    credential: 0,
  };

  let text = input;
  text = replaceAndCount(text, LABELED_CREDENTIAL_PATTERN, 'credential', counts);
  text = replaceAndCount(text, BEARER_PATTERN, 'credential', counts);
  text = replaceAndCount(text, OPENAI_KEY_PATTERN, 'credential', counts);
  text = replaceAndCount(text, JWT_PATTERN, 'credential', counts);
  for (const pattern of PHONE_PATTERNS) {
    text = replaceAndCount(text, pattern, 'phone', counts);
  }
  text = replaceAndCount(text, CARD_PATTERN, 'card', counts);
  text = text.replace(LABELED_NAME_PATTERN, (match: string): string => {
    counts.name += 1;
    return match.startsWith('\n') ? '\n[REDACTED:NAME]' : '[REDACTED:NAME]';
  });

  return {
    kind: 'redacted-ocr',
    text,
    redactionCounts: Object.freeze({ ...counts }),
  };
}
