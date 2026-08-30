import { Injectable } from '@nestjs/common';

export interface ReceiptPlaceMatchSource {
  merchantName: string | null;
  merchantAddress: string | null;
}

export interface ReceiptPlaceMatchPlace {
  placeId: string;
  name: string;
  address: string | null;
  roadAddress: string | null;
  district: string | null;
}

export interface ReceiptPlaceMatchCandidate {
  status: 'candidate';
  placeId: string;
  confidence: number;
  signals: {
    nameSimilarity: number;
    addressSimilarity: number | null;
  };
  requiresUserConfirmation: true;
}

export interface ReceiptPlaceMatchOptions {
  minimumConfidence?: number;
  limit?: number;
}

function normalizeComparable(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/\[mock\]/giu, ' ')
    .replace(/(?:주식회사|\(주\)|㈜|co\.?\s*,?\s*ltd\.?)/giu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function characterBigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/gu, '');
  if (compact.length < 2) {
    return compact.length === 0 ? new Set<string>() : new Set([compact]);
  }

  const result = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    result.add(compact.slice(index, index + 2));
  }
  return result;
}

function diceSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeComparable(left);
  const normalizedRight = normalizeComparable(right);
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const leftBigrams = characterBigrams(normalizedLeft);
  const rightBigrams = characterBigrams(normalizedRight);
  let overlap = 0;
  for (const bigram of leftBigrams) {
    if (rightBigrams.has(bigram)) {
      overlap += 1;
    }
  }
  return (2 * overlap) / (leftBigrams.size + rightBigrams.size);
}

function tokenJaccard(left: string, right: string): number {
  const leftTokens = new Set(normalizeComparable(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalizeComparable(right).split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function roundConfidence(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

@Injectable()
export class DeterministicReceiptPlaceMatcher {
  match(
    receipt: ReceiptPlaceMatchSource,
    places: readonly ReceiptPlaceMatchPlace[],
    options: ReceiptPlaceMatchOptions = {},
  ): ReceiptPlaceMatchCandidate[] {
    if (receipt.merchantName === null || normalizeComparable(receipt.merchantName).length === 0) {
      return [];
    }

    const minimumConfidence = Math.min(1, Math.max(0, options.minimumConfidence ?? 0.35));
    const limit = Math.max(0, Math.trunc(options.limit ?? 5));

    return places
      .map((place): ReceiptPlaceMatchCandidate => {
        const nameSimilarity = diceSimilarity(receipt.merchantName ?? '', place.name);
        const addresses = [place.roadAddress, place.address, place.district].filter(
          (value): value is string => value !== null,
        );
        const addressSimilarity =
          receipt.merchantAddress === null || addresses.length === 0
            ? null
            : Math.max(
                ...addresses.map((address) => tokenJaccard(receipt.merchantAddress ?? '', address)),
              );
        const confidence = roundConfidence(
          addressSimilarity === null
            ? nameSimilarity
            : nameSimilarity * 0.85 + addressSimilarity * 0.15,
        );

        return {
          status: 'candidate',
          placeId: place.placeId,
          confidence,
          signals: {
            nameSimilarity: roundConfidence(nameSimilarity),
            addressSimilarity:
              addressSimilarity === null ? null : roundConfidence(addressSimilarity),
          },
          requiresUserConfirmation: true,
        };
      })
      .filter((candidate) => candidate.confidence >= minimumConfidence)
      .sort(
        (left, right) =>
          right.confidence - left.confidence || left.placeId.localeCompare(right.placeId),
      )
      .slice(0, limit);
  }
}
