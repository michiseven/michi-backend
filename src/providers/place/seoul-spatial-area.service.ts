import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Place, SeoulSpatialArea } from '../../database/entities';
import { knownSeoulSearchArea } from './seoul-area-centers';

export interface ResolvedSeoulArea {
  id: string;
  name: string;
}

export interface NearestCrowdArea {
  areaName: string;
  distanceMeters: number;
}

export interface SpatialPlaceFilterResult {
  places: Place[];
  applied: boolean;
  expanded: boolean;
}

function areaNames(value: string): string[] {
  const compact = value.normalize('NFKC').replaceAll(' ', '');
  const withoutDong = compact.replace(/동$/u, '');
  return [...new Set([compact, withoutDong, `${withoutDong}동`])];
}

@Injectable()
export class SeoulSpatialAreaService {
  constructor(
    @InjectRepository(SeoulSpatialArea)
    private readonly areas: Repository<SeoulSpatialArea>,
  ) {}

  async administrativeArea(areaName: string): Promise<ResolvedSeoulArea | null> {
    const names = areaNames(areaName);
    const area = await this.areas
      .createQueryBuilder('area')
      .where('area.areaKind = :kind', { kind: 'administrative_dong' })
      .andWhere(
        `(regexp_replace(area.name, '\\s+', '', 'g') IN (:...names)
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(area.aliases) alias
            WHERE regexp_replace(alias, '\\s+', '', 'g') IN (:...names)
          ))`,
        { names },
      )
      .orderBy('area.name', 'ASC')
      .getOne();
    return area ? { id: area.id, name: area.name } : null;
  }

  async nearestCrowdArea(
    areaName: string,
    maxDistanceMeters = 3_000,
  ): Promise<NearestCrowdArea | null> {
    const requested = await this.administrativeArea(areaName);
    if (!requested) return null;
    const rows = await this.areas.query<{ areaName: string; distanceMeters: number | string }[]>(
      `
        SELECT crowd.name AS "areaName",
               ST_Distance(requested.geometry::geography, crowd.geometry::geography) AS "distanceMeters"
        FROM seoul_spatial_areas requested
        JOIN LATERAL (
          SELECT candidate.name, candidate.geometry
          FROM seoul_spatial_areas candidate
          WHERE candidate.area_kind = 'crowd_observation'
            AND ST_DWithin(requested.geometry::geography, candidate.geometry::geography, $2)
          ORDER BY ST_Distance(requested.geometry::geography, candidate.geometry::geography) ASC
          LIMIT 1
        ) crowd ON true
        WHERE requested.id = $1
      `,
      [requested.id, maxDistanceMeters],
    );
    const row = rows[0];
    return row
      ? { areaName: row.areaName, distanceMeters: Math.round(Number(row.distanceMeters)) }
      : null;
  }

  /** Validate coordinates before persistence, including provider results without DB IDs. */
  async filterCandidateCoordinates(
    areaName: string,
    places: Place[],
  ): Promise<SpatialPlaceFilterResult> {
    const area = await this.administrativeArea(areaName);
    const center = area ? null : knownSeoulSearchArea(areaName);
    if (!area && !center) return { places: [], applied: false, expanded: false };
    const points = places
      .filter((p) => p.location)
      .map((p) => ({
        id: p.id,
        longitude: p.location!.coordinates[0],
        latitude: p.location!.coordinates[1],
      }));
    const rows = await this.areas.query<Array<{ id: string }>>(
      `WITH points AS (
        SELECT id, ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) AS geometry
        FROM jsonb_to_recordset($1::jsonb) AS p(id text, longitude float8, latitude float8)
      ) SELECT p.id FROM points p WHERE ${
        area
          ? 'EXISTS (SELECT 1 FROM seoul_spatial_areas a WHERE a.id = $2::uuid AND ST_Covers(a.geometry, p.geometry))'
          : 'ST_DWithin(p.geometry::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)'
      }`,
      area
        ? [JSON.stringify(points), area.id]
        : [JSON.stringify(points), center!.longitude, center!.latitude, center!.radiusMeters],
    );
    const ids = new Set(rows.map((row) => row.id));
    return { places: places.filter((p) => ids.has(p.id)), applied: true, expanded: false };
  }

  async filterPlaces(
    areaName: string,
    places: Place[],
    expansionMeters = 1_000,
    minimumInside = 5,
  ): Promise<SpatialPlaceFilterResult> {
    const requested = await this.administrativeArea(areaName);
    const center = requested ? null : knownSeoulSearchArea(areaName);
    if ((!requested && !center) || places.length === 0) {
      return { places, applied: false, expanded: false };
    }
    // Some commonly requested neighbourhoods are commercial areas rather than
    // administrative dongs.  Their verified centre is still a strict spatial
    // boundary; never fall back to an all-Seoul candidate pool in that case.
    if (!requested && center) {
      const rows = await this.areas.query<{ id: string }[]>(
        `SELECT place.id
         FROM places place
         WHERE place.id = ANY($1::uuid[])
           AND place.location IS NOT NULL
           AND ST_DWithin(
             place.location,
             ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
             $4
           )`,
        [places.map((place) => place.id), center.longitude, center.latitude, center.radiusMeters],
      );
      const ids = new Set(rows.map((row) => row.id));
      return {
        places: places.filter((place) => ids.has(place.id)),
        applied: true,
        expanded: false,
      };
    }
    const rows = await this.areas.query<
      { id: string; inside: boolean; distance: number | string }[]
    >(
      `
        SELECT place.id,
               ST_Covers(area.geometry, place.location::geometry) AS inside,
               ST_Distance(place.location, area.geometry::geography) AS distance
        FROM places place
        JOIN seoul_spatial_areas area ON area.id = $1
        WHERE place.id = ANY($2::uuid[])
          AND place.location IS NOT NULL
          AND ST_DWithin(place.location, area.geometry::geography, $3)
        ORDER BY inside DESC, distance ASC, place.id ASC
      `,
      [requested!.id, places.map((place) => place.id), expansionMeters],
    );
    const insideIds = new Set(rows.filter((row) => row.inside).map((row) => row.id));
    const useExpansion = insideIds.size < minimumInside;
    const selectedIds = new Set(
      (useExpansion ? rows : rows.filter((row) => row.inside)).map((row) => row.id),
    );
    return {
      places: places.filter((place) => selectedIds.has(place.id)),
      applied: true,
      expanded: useExpansion && rows.some((row) => !row.inside),
    };
  }
}
