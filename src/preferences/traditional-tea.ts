/** Only an explicit traditional-tea provider label is evidence. Cafe/history
 * categories and the user's request are never venue facts. */
export function requestsTraditionalTea(text: string): boolean {
  return /전통\s*(?:차|찻집)|伝統\s*(?:茶|茶店)|traditional[_\s-]*tea/iu.test(text);
}

export function hasTraditionalTeaEvidence(place: {
  name?: string | null;
  rawCategory?: string | null;
}): boolean {
  return requestsTraditionalTea(`${place.name ?? ''} ${place.rawCategory ?? ''}`);
}
