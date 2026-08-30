import type { TourismImportMode } from '../database/entities/tourism-import-run.entity';

export interface CanonicalTourismDataSource {
  datasetKey: string;
  name: string;
  sourceName: string;
  url: string;
  licenseUseCondition: string | null;
  updateCycle: string | null;
  spatialGranularity: string;
  temporalGranularity: string;
  apiAvailable: boolean;
  csvAvailable: boolean;
  metadata: Record<string, unknown>;
}

export interface CanonicalTourismMetric {
  areaCode: string | null;
  areaName: string | null;
  placeSource: string | null;
  sourcePlaceId: string | null;
  metricType: string;
  value: number;
  unit: string;
  periodStart: string | null;
  periodEnd: string | null;
  dimensions: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface TourismImportRejection {
  row: number;
  code: 'INVALID_ROW' | 'PLACE_NOT_FOUND';
  message: string;
}

export interface ParsedTourismImport {
  schemaVersion: 'michi-tourism-metric-v1';
  source: CanonicalTourismDataSource;
  referencePeriod: string | null;
  mode: TourismImportMode;
  metrics: Array<{ row: number; metric: CanonicalTourismMetric }>;
  rejections: TourismImportRejection[];
}

export interface TourismImportSummary {
  importRunId: string;
  datasetKey: string;
  fileName: string;
  fileSha256: string;
  mode: TourismImportMode;
  skipped: boolean;
  accepted: number;
  rejected: number;
  rejections: TourismImportRejection[];
}
