import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import dataSource from './data-source';
import type { SeoulSpatialAreaKind } from './entities';

interface GeoJsonFeature {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown } | null;
  properties?: Record<string, unknown> | null;
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

function resolvePath(filePath: string): string {
  if (isAbsolute(filePath)) return filePath;
  const candidates = [
    resolve(process.cwd(), filePath),
    resolve(__dirname, '../../..', filePath),
    resolve(__dirname, '../..', filePath),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return resolve(process.cwd(), filePath);
}

function argumentsMap(): Map<string, string> {
  const result = new Map<string, string>();
  for (const argument of process.argv.slice(2)) {
    const match = argument.match(/^--([^=]+)=(.*)$/s);
    if (match?.[1] !== undefined && match[2] !== undefined) result.set(match[1], match[2]);
  }
  return result;
}

function required(args: Map<string, string>, name: string): string {
  const value = args.get(name)?.trim();
  if (!value) throw new Error(`--${name}=... is required`);
  return value;
}

function property(properties: Record<string, unknown>, name: string): string | null {
  const value = properties[name];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

function aliases(properties: Record<string, unknown>, propertyName?: string): string[] {
  const explicit = propertyName ? properties[propertyName] : properties['aliases'];
  if (Array.isArray(explicit)) {
    return explicit.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );
  }
  return typeof explicit === 'string'
    ? explicit
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

export async function importSeoulSpatialAreas(options: {
  file: string;
  source: string;
  sourceUrl: string;
  idProperty: string;
  nameProperty: string;
  districtProperty?: string;
  aliasProperty?: string;
  sourceSrid: number;
  kind: SeoulSpatialAreaKind;
}): Promise<{
  file: string;
  source: string;
  kind: string;
  sourceSrid: number;
  accepted: number;
  repaired?: number;
  rejected: number;
}> {
  const file = resolvePath(options.file);
  const source = options.source;
  const sourceUrl = options.sourceUrl;
  const idProperty = options.idProperty;
  const nameProperty = options.nameProperty;
  const districtProperty = options.districtProperty;
  const aliasProperty = options.aliasProperty;
  const sourceSrid = options.sourceSrid;
  const kind = options.kind;

  if (!['administrative_dong', 'crowd_observation'].includes(kind)) {
    throw new Error('--kind must be administrative_dong or crowd_observation');
  }
  if (!Number.isInteger(sourceSrid) || sourceSrid <= 0) {
    throw new Error('--source-srid must be a positive EPSG integer');
  }
  if (!/^https?:\/\//u.test(sourceUrl)) throw new Error('--source-url must be an HTTP(S) URL');

  const parsed = JSON.parse(await readFile(file, 'utf8')) as GeoJsonFeatureCollection;
  if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
    throw new Error('Input must be a GeoJSON FeatureCollection');
  }

  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  let accepted = 0;
  let repaired = 0;
  let rejected = 0;
  await dataSource.transaction(async (manager) => {
    for (const feature of parsed.features) {
      const properties = feature.properties ?? {};
      const sourceAreaId = property(properties, idProperty);
      const name = property(properties, nameProperty);
      const allowedGeometry =
        feature.geometry && ['Point', 'Polygon', 'MultiPolygon'].includes(feature.geometry.type);
      const administrativeGeometryOk =
        kind !== 'administrative_dong' ||
        (feature.geometry && ['Polygon', 'MultiPolygon'].includes(feature.geometry.type));
      if (!sourceAreaId || !name || !allowedGeometry || !administrativeGeometryOk) {
        rejected += 1;
        continue;
      }
      const district = districtProperty ? property(properties, districtProperty) : null;
      const insertResult = await manager.query<Array<{ was_repaired: boolean }>>(
        `
          WITH raw_shape AS (
            SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($7), $10), 4326) AS geom
          ),
          shape AS (
            SELECT
              CASE WHEN ST_IsValid(geom) THEN geom ELSE ST_MakeValid(geom) END AS geometry,
              NOT ST_IsValid(geom) AS was_repaired
            FROM raw_shape
          )
          INSERT INTO seoul_spatial_areas (
            source, source_area_id, area_kind, name, district, aliases,
            geometry, centroid, source_url, raw_metadata
          )
          SELECT $1, $2, $3, $4, $5, $6::jsonb,
                 shape.geometry,
                 ST_PointOnSurface(shape.geometry)::geography,
                 $8, $9::jsonb
          FROM shape
          ON CONFLICT (source, area_kind, source_area_id) DO UPDATE SET
            name = EXCLUDED.name,
            district = EXCLUDED.district,
            aliases = EXCLUDED.aliases,
            geometry = EXCLUDED.geometry,
            centroid = EXCLUDED.centroid,
            source_url = EXCLUDED.source_url,
            raw_metadata = EXCLUDED.raw_metadata,
            updated_at = now()
          RETURNING (SELECT was_repaired FROM shape) AS was_repaired
        `,
        [
          source,
          sourceAreaId,
          kind,
          name,
          district,
          JSON.stringify(aliases(properties, aliasProperty)),
          JSON.stringify(feature.geometry),
          sourceUrl,
          JSON.stringify(properties),
          sourceSrid,
        ],
      );
      if (insertResult[0]?.was_repaired) {
        repaired += 1;
      }
      accepted += 1;
    }
  });

  return { file, source, kind, sourceSrid, accepted, repaired, rejected };
}

async function run(): Promise<void> {
  const args = argumentsMap();
  const file = required(args, 'file');
  const source = required(args, 'source');
  const sourceUrl = required(args, 'source-url');
  const idProperty = required(args, 'id-property');
  const nameProperty = required(args, 'name-property');
  const districtProperty = args.get('district-property');
  const aliasProperty = args.get('alias-property');
  const sourceSrid = Number(args.get('source-srid') ?? '4326');
  const kind = required(args, 'kind') as SeoulSpatialAreaKind;

  try {
    const result = await importSeoulSpatialAreas({
      file,
      source,
      sourceUrl,
      idProperty,
      nameProperty,
      districtProperty,
      aliasProperty,
      sourceSrid,
      kind,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

if (require.main === module) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `Seoul spatial area import failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
