import { Injectable } from '@nestjs/common';
import type { Place } from '../../database/entities';
import { coordinatesOf, haversineDistanceKm } from '../../recommendation/geo';
import { KTO_PLACE_SOURCE } from './kto-place.provider';

export type DedupReason =
  | 'same_provider_identity'
  | 'same_name_and_proximity'
  | 'same_korean_alias_and_proximity'
  | 'same_phone_and_proximity'
  | 'same_address_and_name_proximity';

export interface DedupMatch {
  keptPlaceId: string;
  keptPlaceName: string;
  droppedPlaceId: string;
  droppedPlaceName: string;
  reason: DedupReason;
  distanceMeters: number | null;
}

export interface DeduplicatedPlaces {
  places: Place[];
  removedCount: number;
  matches: DedupMatch[];
  reasonCounts: Record<DedupReason, number>;
}

function comparable(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function extractParenthesisText(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /\(([^)]+)\)|（([^）]+)）/.exec(value);
  const inside = match?.[1] ?? match?.[2];
  if (!inside) return null;
  const normalized = comparable(inside);
  return normalized.length > 0 ? normalized : null;
}

function phoneFrom(place: Place): string {
  const source = place.rawPayload?.sourceRecord;
  if (typeof source !== 'object' || source === null) return '';
  const record = source as Record<string, unknown>;
  const raw = record.tel ?? record.telephone ?? record.phone;
  return typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
}

function distanceMeters(left: Place, right: Place): number | null {
  const leftPoint = coordinatesOf(left.location);
  const rightPoint = coordinatesOf(right.location);
  return leftPoint && rightPoint
    ? Math.round(haversineDistanceKm(leftPoint, rightPoint) * 1000 * 10) / 10
    : null;
}

export function evaluateDuplicateMatch(
  left: Place,
  right: Place,
): { reason: DedupReason; distanceMeters: number | null } | null {
  if (left.source === right.source && left.sourcePlaceId === right.sourcePlaceId) {
    return { reason: 'same_provider_identity', distanceMeters: distanceMeters(left, right) };
  }

  const distance = distanceMeters(left, right);
  const leftName = comparable(left.name);
  const rightName = comparable(right.name);
  const sameName = leftName.length > 0 && leftName === rightName;

  const leftAlias = extractParenthesisText(left.name);
  const rightAlias = extractParenthesisText(right.name);
  const sameAlias =
    Boolean(leftAlias && (leftAlias === rightName || leftAlias === rightAlias)) ||
    Boolean(rightAlias && (rightAlias === leftName || rightAlias === leftAlias));

  const leftPhone = phoneFrom(left);
  const rightPhone = phoneFrom(right);
  const samePhone = leftPhone.length >= 8 && leftPhone === rightPhone;

  const leftAddress = comparable(left.roadAddress ?? left.address);
  const rightAddress = comparable(right.roadAddress ?? right.address);
  const sameAddress =
    leftAddress.length >= 6 &&
    rightAddress.length >= 6 &&
    (leftAddress === rightAddress ||
      leftAddress.includes(rightAddress) ||
      rightAddress.includes(leftAddress));

  if (sameAddress && (sameName || sameAlias) && distance !== null && distance <= 80) {
    return { reason: 'same_address_and_name_proximity', distanceMeters: distance };
  }

  if (sameName && distance !== null && distance <= 150) {
    return { reason: 'same_name_and_proximity', distanceMeters: distance };
  }

  if (sameAlias && distance !== null && distance <= 150) {
    return { reason: 'same_korean_alias_and_proximity', distanceMeters: distance };
  }

  if (samePhone && distance !== null && distance <= 300) {
    return { reason: 'same_phone_and_proximity', distanceMeters: distance };
  }

  return null;
}

function sourcePriority(place: Place): number {
  if (place.source === KTO_PLACE_SOURCE) return 0;
  if (place.source === 'kakao-local') return 1;
  if (place.source === 'naver-local') return 2;
  return 3;
}

@Injectable()
export class PlaceDeduplicator {
  deduplicate(input: Place[]): DeduplicatedPlaces {
    const ordered = [...input].sort(
      (left, right) =>
        sourcePriority(left) - sourcePriority(right) || left.id.localeCompare(right.id),
    );

    const places: Place[] = [];
    const matches: DedupMatch[] = [];
    const reasonCounts: Record<DedupReason, number> = {
      same_provider_identity: 0,
      same_name_and_proximity: 0,
      same_korean_alias_and_proximity: 0,
      same_phone_and_proximity: 0,
      same_address_and_name_proximity: 0,
    };

    for (const candidate of ordered) {
      let matched = false;
      for (const existing of places) {
        const match = evaluateDuplicateMatch(existing, candidate);
        if (match) {
          matched = true;
          matches.push({
            keptPlaceId: existing.id,
            keptPlaceName: existing.name,
            droppedPlaceId: candidate.id,
            droppedPlaceName: candidate.name,
            reason: match.reason,
            distanceMeters: match.distanceMeters,
          });
          reasonCounts[match.reason] += 1;
          break;
        }
      }
      if (!matched) {
        places.push(candidate);
      }
    }

    return {
      places,
      removedCount: input.length - places.length,
      matches,
      reasonCounts,
    };
  }
}
