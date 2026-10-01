import type { Place } from '../../database/entities';
import { coordinatesOf, haversineDistanceKm } from '../../recommendation/geo';

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/<[^>]+>/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Conservative identity for replacement choices, not a database merge policy.
 * Input order chooses the representative and retains its existing ID/facts. */
export function deduplicateReplacementPlaces(ordered: Place[]): Place[] {
  const unique: Place[] = [];
  for (const candidate of ordered) {
    const duplicate = unique.some((kept) => {
      if (
        kept.source?.trim() &&
        kept.sourcePlaceId?.trim() &&
        kept.source === candidate.source &&
        kept.sourcePlaceId === candidate.sourcePlaceId
      )
        return true;
      const name = normalize(kept.name);
      const address = normalize(kept.roadAddress || kept.address);
      if (
        !name ||
        name !== normalize(candidate.name) ||
        address.length < 6 ||
        address !== normalize(candidate.roadAddress || candidate.address)
      )
        return false;
      const left = coordinatesOf(kept.location ?? null);
      const right = coordinatesOf(candidate.location ?? null);
      return left !== null && right !== null && haversineDistanceKm(left, right) * 1000 <= 80;
    });
    if (!duplicate) unique.push(candidate);
  }
  return unique;
}
