export interface SeoulSearchArea {
  longitude: number;
  latitude: number;
  radiusMeters: number;
}

const SEOUL_CENTER: SeoulSearchArea = {
  longitude: 126.978,
  latitude: 37.5665,
  radiusMeters: 20_000,
};

const AREA_CENTERS: Readonly<Record<string, SeoulSearchArea>> = {
  성수: { longitude: 127.0447, latitude: 37.5444, radiusMeters: 3_500 },
  서울숲: { longitude: 127.0374, latitude: 37.5444, radiusMeters: 3_500 },
  홍대: { longitude: 126.9237, latitude: 37.5563, radiusMeters: 3_500 },
  연남: { longitude: 126.9227, latitude: 37.566, radiusMeters: 3_000 },
  강남: { longitude: 127.0276, latitude: 37.4979, radiusMeters: 4_000 },
  명동: { longitude: 126.986, latitude: 37.5636, radiusMeters: 3_000 },
  이태원: { longitude: 126.9946, latitude: 37.5345, radiusMeters: 3_500 },
  종로: { longitude: 126.9816, latitude: 37.5704, radiusMeters: 4_000 },
  익선동: { longitude: 126.989, latitude: 37.5743, radiusMeters: 2_500 },
  북촌: { longitude: 126.9849, latitude: 37.5826, radiusMeters: 2_500 },
  동대문: { longitude: 127.009, latitude: 37.571, radiusMeters: 3_500 },
  잠실: { longitude: 127.1002, latitude: 37.5133, radiusMeters: 4_000 },
  여의도: { longitude: 126.924, latitude: 37.5219, radiusMeters: 3_500 },
  이대: { longitude: 126.9468, latitude: 37.5585, radiusMeters: 2_500 },
  망원: { longitude: 126.9101, latitude: 37.5561, radiusMeters: 2_500 },
};

const AREA_DISTRICTS: Readonly<Record<string, string>> = {
  성수: '성동구',
  서울숲: '성동구',
  홍대: '마포구',
  연남: '마포구',
  망원: '마포구',
  강남: '강남구',
  명동: '중구',
  이태원: '용산구',
  종로: '종로구',
  익선동: '종로구',
  북촌: '종로구',
  잠실: '송파구',
  여의도: '영등포구',
  이대: '서대문구',
};

export function seoulSearchArea(area: string): SeoulSearchArea {
  return knownSeoulSearchArea(area) ?? SEOUL_CENTER;
}

export function knownSeoulSearchArea(area: string): SeoulSearchArea | null {
  const raw = area.normalize('NFKC').replaceAll(' ', '');
  const withoutDong = raw.replace(/동$/, '');
  const withDong = withoutDong + '동';
  return AREA_CENTERS[raw] ?? AREA_CENTERS[withoutDong] ?? AREA_CENTERS[withDong] ?? null;
}

export function seoulDistrictForArea(area: string): string | null {
  const raw = area.normalize('NFKC').replaceAll(' ', '');
  const withoutDong = raw.replace(/동$/, '');
  const withDong = withoutDong + '동';
  return AREA_DISTRICTS[raw] ?? AREA_DISTRICTS[withoutDong] ?? AREA_DISTRICTS[withDong] ?? null;
}
