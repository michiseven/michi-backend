import type { Place } from '../../database/entities';
import { coordinatesOf, haversineDistanceKm } from '../../recommendation/geo';

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/<[^>]+>/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function addressIdentity(value: string | null | undefined): { building: string; units: string[] } {
  const text = (value ?? '').normalize('NFKC').replace(/^서울(?:특별시|시)?\s*/u, '서울 ');
  const units = [...text.matchAll(/(?:지하\s*)?\d+\s*층|\d+\s*호(?=\s|$)/gu)]
    .map((match) => normalize(match[0]))
    .sort();
  return {
    building: normalize(text.replace(/(?:지하\s*)?\d+\s*층|\d+\s*호(?=\s|$)/gu, '')),
    units,
  };
}

/** Conservative identity for replacement choices, not a database merge policy.
 * Input order chooses the representative and retains its existing ID/facts. */
export function deduplicateReplacementPlaces(ordered: Place[]): Place[] {
  const unique: Place[] = [];
  const knownUnits = new Map<Place, string[]>();
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
      const address = addressIdentity(kept.roadAddress || kept.address);
      const candidateAddress = addressIdentity(candidate.roadAddress || candidate.address);
      const keptUnits = knownUnits.get(kept) ?? address.units;
      if (
        !name ||
        name !== normalize(candidate.name) ||
        address.building.length < 6 ||
        address.building !== candidateAddress.building ||
        (keptUnits.length > 0 &&
          candidateAddress.units.length > 0 &&
          keptUnits.join(',') !== candidateAddress.units.join(','))
      )
        return false;
      const left = coordinatesOf(kept.location ?? null);
      const right = coordinatesOf(candidate.location ?? null);
      const matches =
        left !== null && right !== null && haversineDistanceKm(left, right) * 1000 <= 80;
      // Preserve newly known unit evidence even when the representative omits
      // it, so an unknown-floor record cannot bridge two distinct floors.
      if (matches && keptUnits.length === 0 && candidateAddress.units.length > 0)
        knownUnits.set(kept, candidateAddress.units);
      return matches;
    });
    if (!duplicate) unique.push(candidate);
  }
  return unique;
}
