const NORTH_KOREA_PATTERNS: readonly RegExp[] = [
  /조선민주주의인민공화국/i,
  /\bDPRK\b/i,
  /\bNorth\s*Korea(?:n)?\b/i,
  /\bDMZ\b/i,
  /비무장지대/,
  /판문점/,
  /공동경비구역/,
  /\bJSA\b/i,
  /제[1-4]땅굴/,
  /땅굴/,
  /도라산/,
  /도라전망대/,
  /통일전망대/,
  /오두산/,
  /임진각/,
  /평화누리/,
  /탈북/,
  /새터민/,
  /남파간첩/,
  /대남공작/,
  /노동당사/,
  /인민군/,
  /군사분계선/,
  /휴전선/,
  /김일성/,
  /김정일/,
  /김정은/,
];

/**
 * Checks whether a given string is related to North Korea, DMZ, border division, or political security topics.
 * Accurately distinguishes Bukhansan Mountain in Seoul (북한산) unless other negative keywords are present.
 */
export function isNorthKoreaRelated(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false;
  const normalized = text.normalize('NFKC').trim();
  if (!normalized) return false;

  // Direct pattern match
  if (NORTH_KOREA_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  // Check '북한' while allowing '북한산' (Bukhansan Mountain/National Park in Seoul)
  if (normalized.includes('북한')) {
    const stripped = normalized.replace(/북한산(?:성|국립공원|로|길|역)?/g, '');
    if (stripped.includes('북한')) {
      return true;
    }
  }

  return false;
}
