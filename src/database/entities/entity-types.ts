export type ProviderMode = 'mock' | 'live';
export type TripStatus = 'generating' | 'ready' | 'modified' | 'failed';

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: [number, number][][];
}

export interface GeoMultiPolygon {
  type: 'MultiPolygon';
  coordinates: [number, number][][][];
}

export type GeoGeometry = GeoPoint | GeoPolygon | GeoMultiPolygon;

export interface ScoreBreakdownSnapshot {
  total: number;
  preference: number;
  crowd: number;
  distance: number;
  time: number;
  budget: number;
  diversity: number;
  area: number;
  tourismDispersion?: number | null;
  localImpact?: number | null;
}

export interface CrowdContextSnapshot {
  provider: string;
  providerMode: ProviderMode;
  scope: 'area';
  areaName: string;
  congestionLevel: string | null;
  observedAt: string | null;
  disclaimer: string;
  requestedAreaName?: string;
  referenceDistanceMeters?: number;
}

export type ExplanationMode = 'live' | 'mock' | 'fallback';

export interface TripExplanation {
  tripSummary: string;
  locale: 'ko' | 'ja';
  mode: ExplanationMode;
  model: string | null;
  generatedAt?: string;
}

export interface StopExplanation {
  shortDescription: string;
  previousStopFit: string | null;
  nextStopFit: string | null;
  overallTripFit: string;
}

export interface MenuItemEvidence {
  name: string;
  priceKrw: number;
  recommend?: boolean;
}

export interface PriceEvidence {
  source: 'kakao-place-menu' | 'kto-detail' | 'manual';
  verificationStatus: 'verified';
  sourceUrl?: string;
  sourceTitle?: string;
  representativeMenu?: string;
  menuList?: MenuItemEvidence[];
  averageCostKrw: number;
  minPriceKrw?: number | null;
  maxPriceKrw?: number | null;
  sampleCount?: number;
  lastFetchedAt: string;
  referencePeriod?: string;
  referenceDate?: string;
  disclaimer?: string;
}
