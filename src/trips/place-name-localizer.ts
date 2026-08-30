export type PlaceNameLocale = 'ko' | 'ja';

const KOREAN_PLACE_NAMES: Record<string, string> = {
  '[MOCK] 静かなカフェ': '[MOCK] 조용한 카페',
  '[MOCK] セレクトショップ': '[MOCK] 편집숍',
  '[MOCK] 焼肉店': '[MOCK] 고깃집',
  '[MOCK] ソウルの公園': '[MOCK] 서울의 공원',
};

function extractKoreanAlias(name: string): string | null {
  const matches = name.matchAll(/[（(]([^）)]*[가-힣][^）)]*)[）)]/gu);
  let lastAlias: string | null = null;
  for (const match of matches) {
    const alias = match[1]?.trim();
    if (alias) lastAlias = alias;
  }
  return lastAlias;
}

/**
 * 원본 Place 레코드는 외부 제공자 데이터 그대로 보존하고, 설명/API 응답에서만
 * 검증 가능한 한국어 이름을 선택한다. 한글 별칭이 없는 이름을 임의 번역하지 않는다.
 */
export function localizePlaceName(name: string, locale: PlaceNameLocale): string {
  if (locale !== 'ko') return name;
  return KOREAN_PLACE_NAMES[name] ?? extractKoreanAlias(name) ?? name;
}
