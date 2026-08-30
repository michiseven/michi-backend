import type { CandidatePlace } from './ports';

export const FRANCHISE_PATTERNS = [
  /스타벅스|starbucks/i,
  /투썸|twosome/i,
  /이디야|ediya/i,
  /빽다방/i,
  /메가커피|mega\s*coffee|메가\s*mgc/i,
  /컴포즈|compose\s*coffee/i,
  /할리스|hollys/i,
  /파스쿠찌|pascucci/i,
  /폴바셋|paul\s*bassett/i,
  /공차|gong\s*cha/i,
  /블루보틀|blue\s*bottle/i,
  /포비|fourb/i,
  /배스킨라빈스|baskin\s*robbins/i,
  /던킨|dunkin/i,
  /설빙|sulbing/i,
  /맥도날드|mcdonald/i,
  /롯데리아|lotteria/i,
  /버거킹|burger\s*king/i,
  /kfc/i,
  /맘스터치|mom'?s\s*touch/i,
  /서브웨이|subway/i,
  /파리바게[뜨트]|paris\s*baguette/i,
  /뚜레[쥬주]르|tous\s*les\s*jours/i,
  /올리브영|olive\s*young/i,
  /다이소|daiso/i,
  /이마트|emart/i,
  /홈플러스|homeplus/i,
  /롯데마트|lotte\s*mart/i,
  /교보문고|kyobo/i,
  /영풍문고/i,
  /무인양품|muji/i,
  /유니클로|uniqlo/i,
  /자라|zara/i,
  /에이치엔엠|h&m/i,
  /스파오|spao/i,
  /탑텐|topten/i,
  /아웃백|outback/i,
  /애슐리|ashley/i,
  /빕스|vips/i,
  /탐앤탐스|tom\s*n\s*toms/i,
  /엔제리너스|angel-in-us/i,
  /달콤커피|dalkomm/i,
  /엠플레이그라운드|mplayground/i,
  /에이랜드|aland/i,
];

/**
 * Extracts a normalized brand/franchise identifier from a place name.
 * If the place belongs to a known franchise or matches branch naming conventions ("OOO XX점"),
 * returns the common root brand string (e.g. "스타벅스", "올리브영", "포비").
 */
export function extractBrandKey(
  place: CandidatePlace | { name: string; rawCategory?: string },
): string | null {
  const name = place.name.normalize('NFKC').trim();

  for (const pattern of FRANCHISE_PATTERNS) {
    const match = pattern.exec(name);
    if (match) {
      return match[0].toLowerCase().replace(/[\s'-]+/g, '');
    }
  }

  // Remove parentheses: "카페이름 (지점명)" -> "카페이름"
  const noParen = name.replace(/\([^)]+\)|（[^）]+）|\[[^\]]+\]/g, '').trim();

  // Pattern: "브랜드명 XX점", "브랜드명 XX호점", "브랜드명 본점", "브랜드명 직영점", "브랜드명 XX스토어"
  const branchPattern = /^(.+?)\s+([가-힣a-zA-Z0-9]+(점|호점|본점|직영점|스토어|센터|로드점))$/;
  const branchMatch = branchPattern.exec(noParen);
  if (branchMatch?.[1] && branchMatch[1].trim().length >= 2) {
    return branchMatch[1]
      .trim()
      .toLowerCase()
      .replace(/[\s'-]+/g, '');
  }

  return null;
}
