import type { PriceEvidence } from '../../database/entities/entity-types';

const VERIFIED_PRICE_SOURCES = new Set(['kakao-place-menu', 'kto-detail', 'manual']);

export interface VerifiedPlacePrice {
  estimatedCostKrw: number;
  priceEvidence: PriceEvidence;
}

function validKrw(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100_000_000;
}

/**
 * Rejects old heuristic/search-derived values at every API boundary.
 * The database migration removes those rows, but this guard also protects
 * instances that have not applied the migration yet.
 */
export function verifiedPlacePrice(
  estimatedCostKrw: number | null | undefined,
  evidence: PriceEvidence | Record<string, unknown> | null | undefined,
): VerifiedPlacePrice | null {
  if (!validKrw(estimatedCostKrw) || !evidence || typeof evidence !== 'object') return null;

  const source = evidence.source;
  if (typeof source !== 'string' || !VERIFIED_PRICE_SOURCES.has(source)) return null;
  if (evidence.verificationStatus !== 'verified') return null;
  if (!validKrw(evidence.averageCostKrw)) return null;
  if (
    typeof evidence.lastFetchedAt !== 'string' ||
    Number.isNaN(Date.parse(evidence.lastFetchedAt))
  ) {
    return null;
  }

  if (
    source !== 'manual' &&
    (typeof evidence.sourceUrl !== 'string' || !evidence.sourceUrl.trim())
  ) {
    return null;
  }
  if (
    source === 'manual' &&
    (typeof evidence.sourceTitle !== 'string' || !evidence.sourceTitle.trim())
  ) {
    return null;
  }

  return {
    estimatedCostKrw,
    priceEvidence: evidence as unknown as PriceEvidence,
  };
}
