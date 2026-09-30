function compact(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/<[^>]*>/gu, '')
    .replace(/\s+/gu, '');
}

const LANDMARK_ALIASES: readonly (readonly string[])[] = [
  ['경복궁', '景福宮', 'gyeongbokgung', 'gyeongbokgungpalace', '경복궁(景福宮)'],
  ['서울숲', '서울숲공원', 'ソウルの森', 'seoulforest', 'seoulforestpark'],
  ['리움', '리움미술관', 'リウム美術館', 'リウム', 'leeum', 'leeummuseum', 'leeummuseumofart'],
];

/** A venue named after a landmark is not the landmark itself. */
export function matchesExactPlaceIdentity(query: string, name: string): boolean {
  const q = compact(query).replace(/(?:자체|そのもの|itself)$/u, '');
  const n = compact(name);
  if (!q || !n) return false;
  const aliases = LANDMARK_ALIASES.find((group) => group.some((alias) => compact(alias) === q));
  return aliases ? aliases.some((alias) => compact(alias) === n) : q === n;
}

export function exactPlaceAliases(query: string): string[] {
  const q = compact(query).replace(/(?:자체|そのもの|itself)$/u, '');
  const aliases = LANDMARK_ALIASES.find((group) => group.some((alias) => compact(alias) === q));
  return aliases ? [...aliases] : [query];
}
