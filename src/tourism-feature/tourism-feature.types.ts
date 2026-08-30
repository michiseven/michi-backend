import type { TourismConcentrationResult } from './tourism-concentration';

export type TourismDataMode = 'live' | 'mock' | 'mixed' | 'unavailable';

export interface TourismSourceEvidence {
  sourceRef: string;
  sourceName: string;
  dataset: string;
  sourceUrl: string;
  referencePeriod: string | null;
  importedAt: string;
  mode: 'live' | 'mock';
}

export interface TourismPlaceFeatureEvidence {
  concentration: TourismConcentrationResult;
  tourismFlow: number | null;
  referencePeriod: string | null;
  spatialScope: 'place' | 'area';
  areaName: string | null;
  dataMode: TourismDataMode;
  sources: TourismSourceEvidence[];
}
