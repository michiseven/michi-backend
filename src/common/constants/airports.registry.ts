export interface AirportInfo {
  code: 'ICN_T1' | 'ICN_T2' | 'GMP_INTL' | 'GMP_DOM';
  iata: 'ICN' | 'GMP';
  terminal: 'T1' | 'T2' | 'International' | 'Domestic';
  nameKo: string;
  nameJa: string;
  nameEn: string;
  aliases: readonly string[];
  latitude: number;
  longitude: number;
  address: string;
  roadAddress: string;
  transitSummaryKo: string;
  transitSummaryJa: string;
  transitLines: readonly string[];
}

export const VERIFIED_AIRPORTS: readonly AirportInfo[] = [
  {
    code: 'ICN_T1',
    iata: 'ICN',
    terminal: 'T1',
    nameKo: '인천국제공항 제1여객터미널',
    nameJa: '仁川国際空港 第1旅客ターミナル',
    nameEn: "Incheon Int'l Airport Terminal 1",
    aliases: [
      '인천공항',
      '인천국제공항',
      '인천공항 T1',
      '인천공항 제1터미널',
      '인천국제공항 제1여객터미널',
      'ICN',
      'ICN_T1',
      '仁川空港',
      '仁川国際空港',
      '仁川T1',
      '仁川第1ターミナル',
      'Incheon Airport',
    ],
    latitude: 37.4485,
    longitude: 126.4505,
    address: '인천광역시 중구 운서동 2840',
    roadAddress: '인천광역시 중구 공항로 271',
    transitSummaryKo: '공항철도(AREX) 직통/일반열차, 공항버스',
    transitSummaryJa: '空港鉄道(AREX) 直通/一般列車、空港リムジンバス',
    transitLines: ['AREX'],
  },
  {
    code: 'ICN_T2',
    iata: 'ICN',
    terminal: 'T2',
    nameKo: '인천국제공항 제2여객터미널',
    nameJa: '仁川国際空港 第2旅客ターミナル',
    nameEn: "Incheon Int'l Airport Terminal 2",
    aliases: [
      '인천공항 T2',
      '인천공항 제2터미널',
      '인천국제공항 제2여객터미널',
      'ICN_T2',
      '仁川T2',
      '仁川第2ターミナル',
      'Incheon Airport T2',
    ],
    latitude: 37.4692,
    longitude: 126.4628,
    address: '인천광역시 중구 운서동 2868',
    roadAddress: '인천광역시 중구 제2터미널대로 446',
    transitSummaryKo: '공항철도(AREX) 직통/일반열차, 공항버스',
    transitSummaryJa: '空港鉄道(AREX) 直通/一般列車、空港リムジンバス',
    transitLines: ['AREX'],
  },
  {
    code: 'GMP_INTL',
    iata: 'GMP',
    terminal: 'International',
    nameKo: '김포국제공항 국제선',
    nameJa: '金浦国際空港 国際線',
    nameEn: "Gimpo Int'l Airport International Terminal",
    aliases: [
      '김포공항',
      '김포국제공항',
      '김포공항 국제선',
      '김포국제공항 국제선',
      'GMP',
      'GMP_INTL',
      '金浦空港',
      '金浦国際空港',
      '金浦国際線',
      'Gimpo Airport',
    ],
    latitude: 37.5585,
    longitude: 126.8013,
    address: '서울특별시 강서구 방화동 886',
    roadAddress: '서울특별시 강서구 하늘길 112',
    transitSummaryKo: '공항철도, 지하철 5호선, 9호선 급행, 김포골드라인, 서해선',
    transitSummaryJa: '空港鉄道、地下鉄5号線、9号線急行、金浦ゴールドライン、西海線',
    transitLines: ['AREX', 'Line_5', 'Line_9', 'Gimpo_Gold', 'Seohae'],
  },
  {
    code: 'GMP_DOM',
    iata: 'GMP',
    terminal: 'Domestic',
    nameKo: '김포국제공항 국내선',
    nameJa: '金浦国際空港 国内선',
    nameEn: "Gimpo Int'l Airport Domestic Terminal",
    aliases: ['김포공항 국내선', '김포국제공항 국내선', 'GMP_DOM', '金浦国内線', 'Gimpo Domestic'],
    latitude: 37.562,
    longitude: 126.801,
    address: '서울특별시 강서구 방화동 886',
    roadAddress: '서울특별시 강서구 하늘길 112',
    transitSummaryKo: '공항철도, 지하철 5호선, 9호선 급행, 김포골드라인, 서해선',
    transitSummaryJa: '空港鉄道、地下鉄5号線、9号線急行、金浦ゴールドライン、西海線',
    transitLines: ['AREX', 'Line_5', 'Line_9', 'Gimpo_Gold', 'Seohae'],
  },
];

export function findVerifiedAirport(query: string | null | undefined): AirportInfo | null {
  if (!query || typeof query !== 'string') return null;
  const raw = query.trim();
  if (raw.length === 0) return null;

  // Exact code match
  const byCode = VERIFIED_AIRPORTS.find(
    (a) => a.code.toLowerCase() === raw.toLowerCase() || a.iata.toLowerCase() === raw.toLowerCase(),
  );
  if (byCode) return byCode;

  // Check specific terminal mentions first (T2 or domestic)
  const isT2 = /T2|제2|2터미널|第2/i.test(raw);
  const isDomestic = /국내|国内|domestic/i.test(raw);

  if (/인천|仁川|incheon|icn/i.test(raw)) {
    return isT2
      ? VERIFIED_AIRPORTS.find((a) => a.code === 'ICN_T2')!
      : VERIFIED_AIRPORTS.find((a) => a.code === 'ICN_T1')!;
  }

  if (/김포|金浦|gimpo|gmp/i.test(raw)) {
    return isDomestic
      ? VERIFIED_AIRPORTS.find((a) => a.code === 'GMP_DOM')!
      : VERIFIED_AIRPORTS.find((a) => a.code === 'GMP_INTL')!;
  }

  // Alias lookup
  const normalized = raw.toLowerCase().replace(/\s+/g, '');
  for (const airport of VERIFIED_AIRPORTS) {
    for (const alias of airport.aliases) {
      if (alias.toLowerCase().replace(/\s+/g, '') === normalized) {
        return airport;
      }
    }
  }

  return null;
}
