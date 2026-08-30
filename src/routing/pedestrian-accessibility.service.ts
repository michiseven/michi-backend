import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { GeoPoint } from '../database/entities';
import type { AccessibilityLegEvidence } from './accessibility-evidence';

interface AccessibilityQueryRow {
  dataset_count: string;
  corridor_count: string;
  stairs_count: string;
  steep_count: string;
  explicit_max_slope: number | string | null;
  start_elevation: number | string | null;
  end_elevation: number | string | null;
  leg_distance_meters: number | string;
  source_refs: string[] | null;
}

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

@Injectable()
export class PedestrianAccessibilityService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async evaluateLeg(
    origin: GeoPoint | null,
    destination: GeoPoint | null,
  ): Promise<AccessibilityLegEvidence> {
    if (!origin || !destination)
      return this.unavailable('장소 좌표가 없어 GIS 검사를 수행하지 못했습니다.');

    const corridorMeters = this.config.get<number>('ACCESSIBILITY_CORRIDOR_METERS') ?? 20;
    const elevationSearchMeters =
      this.config.get<number>('ACCESSIBILITY_ELEVATION_SEARCH_METERS') ?? 200;
    const rows = await this.dataSource.query<AccessibilityQueryRow[]>(
      `
        WITH points AS (
          SELECT
            ST_SetSRID(ST_MakePoint($1, $2), 4326) AS start_geom,
            ST_SetSRID(ST_MakePoint($3, $4), 4326) AS end_geom
        ), leg AS (
          SELECT
            start_geom,
            end_geom,
            ST_MakeLine(start_geom, end_geom) AS line,
            ST_Distance(start_geom::geography, end_geom::geography) AS distance_meters
          FROM points
        ), corridor AS (
          SELECT f.*
          FROM pedestrian_accessibility_features f, leg
          WHERE ST_DWithin(f.geometry::geography, leg.line::geography, $5)
        ), start_elevation AS (
          SELECT f.elevation_meters
          FROM pedestrian_accessibility_features f, leg
          WHERE f.feature_type = 'elevation_point'
            AND f.elevation_meters IS NOT NULL
            AND ST_DWithin(f.geometry::geography, leg.start_geom::geography, $6)
          ORDER BY ST_Distance(f.geometry::geography, leg.start_geom::geography)
          LIMIT 1
        ), end_elevation AS (
          SELECT f.elevation_meters
          FROM pedestrian_accessibility_features f, leg
          WHERE f.feature_type = 'elevation_point'
            AND f.elevation_meters IS NOT NULL
            AND ST_DWithin(f.geometry::geography, leg.end_geom::geography, $6)
          ORDER BY ST_Distance(f.geometry::geography, leg.end_geom::geography)
          LIMIT 1
        )
        SELECT
          (SELECT count(*) FROM pedestrian_accessibility_features)::text AS dataset_count,
          (SELECT count(*) FROM corridor)::text AS corridor_count,
          (SELECT count(*) FROM corridor WHERE feature_type = 'stairs')::text AS stairs_count,
          (SELECT count(*) FROM corridor WHERE feature_type = 'steep_segment')::text AS steep_count,
          (SELECT max(slope_percent) FROM corridor)::double precision AS explicit_max_slope,
          (SELECT elevation_meters FROM start_elevation)::double precision AS start_elevation,
          (SELECT elevation_meters FROM end_elevation)::double precision AS end_elevation,
          leg.distance_meters::double precision AS leg_distance_meters,
          (SELECT array_agg(DISTINCT source_url) FROM corridor) AS source_refs
        FROM leg
      `,
      [
        origin.coordinates[0],
        origin.coordinates[1],
        destination.coordinates[0],
        destination.coordinates[1],
        corridorMeters,
        elevationSearchMeters,
      ],
    );
    const row = rows[0];
    if (!row || Number(row.dataset_count) === 0) {
      return this.unavailable('경사도·계단 GIS 데이터가 아직 적재되지 않았습니다.');
    }

    const startElevation = numeric(row.start_elevation);
    const endElevation = numeric(row.end_elevation);
    const legDistance = numeric(row.leg_distance_meters);
    const derivedGradePercent =
      startElevation !== null && endElevation !== null && legDistance !== null && legDistance > 0
        ? (Math.abs(endElevation - startElevation) / legDistance) * 100
        : null;
    const explicitMaxSlopePercent = numeric(row.explicit_max_slope);
    const threshold = this.config.get<number>('ACCESSIBILITY_STEEP_SLOPE_PERCENT') ?? 8;
    const stairFeatureCount = Number(row.stairs_count);
    const steepFeatureCount = Number(row.steep_count);
    const steep =
      steepFeatureCount > 0 ||
      (explicitMaxSlopePercent !== null && explicitMaxSlopePercent >= threshold) ||
      (derivedGradePercent !== null && derivedGradePercent >= threshold);
    const stairs = stairFeatureCount > 0;

    return {
      status: 'checked',
      method: 'seoul-gis-straight-corridor-v1',
      risk:
        stairs && steep
          ? 'steep-and-stairs'
          : stairs
            ? 'stairs'
            : steep
              ? 'steep'
              : 'none-detected',
      derivedGradePercent,
      explicitMaxSlopePercent,
      stairFeatureCount,
      steepFeatureCount,
      sourceRefs: row.source_refs ?? [],
      disclaimer:
        '서울시 공개 GIS를 장소 간 직선 회랑에 매핑한 위험 탐지값입니다. 실제 보행 네트워크 전체의 무장애 경로를 보장하지 않습니다.',
    };
  }

  private unavailable(disclaimer: string): AccessibilityLegEvidence {
    return {
      status: 'unavailable',
      method: 'unavailable',
      risk: 'unknown',
      derivedGradePercent: null,
      explicitMaxSlopePercent: null,
      stairFeatureCount: 0,
      steepFeatureCount: 0,
      sourceRefs: [],
      disclaimer,
    };
  }
}
