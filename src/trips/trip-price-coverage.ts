import type { PriceEvidence } from '../database/entities/entity-types';
import { verifiedPlacePrice } from '../providers/place/place-price-evidence';

interface PriceCoveredStop {
  estimatedCost: number | null;
  place?: { priceEvidence?: PriceEvidence | null } | null;
}

export function incompletePriceWarning(
  stops: PriceCoveredStop[],
  locale: 'ko' | 'ja',
): string | null {
  if (stops.length === 0) return null;
  const hasUnknownPrice = stops.some(
    (stop) => !verifiedPlacePrice(stop.estimatedCost, stop.place?.priceEvidence),
  );
  if (!hasUnknownPrice) return null;
  return locale === 'ja'
    ? '確認できない場所の価格は推測していないため、総予算を完全には検証できません。最新価格は外部の場所詳細ページで確認してください。'
    : '확인되지 않은 장소 가격은 추측하지 않아 전체 예산을 완전히 검증할 수 없습니다. 최신 가격은 외부 장소 상세 페이지에서 확인해 주세요.';
}
