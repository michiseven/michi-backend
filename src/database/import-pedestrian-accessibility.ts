import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import dataSource from './data-source';
import type { PedestrianAccessibilityFeatureType } from './entities';

interface GeoJsonFeature {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown } | null;
  properties?: Record<string, unknown> | null;
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

function argsMap(): Map<string, string> {
  return new Map(
    process.argv
      .slice(2)
      .map((value) => value.match(/^--([^=]+)=(.*)$/s))
      .filter((match): match is RegExpMatchArray => Boolean(match?.[1]))
      .map((match) => [match[1]!, match[2] ?? '']),
  );
}

function required(args: Map<string, string>, name: string): string {
  const value = args.get(name)?.trim();
  if (!value) throw new Error(`--${name}=... is required`);
  return value;
}

function resolvedPath(file: string): string {
  if (isAbsolute(file)) return file;
  const candidates = [resolve(process.cwd(), file), resolve(__dirname, '../../..', file)];
  return candidates.find(existsSync) ?? candidates[0]!;
}

function property(properties: Record<string, unknown>, name?: string): string | number | null {
  if (!name) return null;
  const value = properties[name];
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

export async function importPedestrianAccessibility(options: {
  file: string;
  source: string;
  sourceUrl: string;
  sourceSrid: number;
  featureType?: PedestrianAccessibilityFeatureType;
  featureTypeProperty?: string;
  idProperty: string;
  elevationProperty?: string;
  slopeProperty?: string;
  collectedAt: string;
}): Promise<{ accepted: number; rejected: number }> {
  const parsed = JSON.parse(
    await readFile(resolvedPath(options.file), 'utf8'),
  ) as GeoJsonFeatureCollection;
  if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
    throw new Error('Input must be a GeoJSON FeatureCollection');
  }
  if (!/^https?:\/\//u.test(options.sourceUrl)) throw new Error('--source-url must be HTTP(S)');
  if (!dataSource.isInitialized) await dataSource.initialize();

  const allowed = new Set<PedestrianAccessibilityFeatureType>([
    'elevation_point',
    'contour',
    'stairs',
    'steep_segment',
  ]);
  let accepted = 0;
  let rejected = 0;
  await dataSource.transaction(async (manager) => {
    for (const feature of parsed.features) {
      const properties = feature.properties ?? {};
      const id = property(properties, options.idProperty);
      const rawType = options.featureType ?? property(properties, options.featureTypeProperty);
      const featureType = String(rawType ?? '') as PedestrianAccessibilityFeatureType;
      const geometryOk =
        feature.geometry &&
        ['Point', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(
          feature.geometry.type,
        );
      if (id === null || !allowed.has(featureType) || !geometryOk) {
        rejected += 1;
        continue;
      }
      const elevation = Number(property(properties, options.elevationProperty));
      const slope = Number(property(properties, options.slopeProperty));
      await manager.query(
        `
          INSERT INTO pedestrian_accessibility_features (
            source, source_feature_id, feature_type, elevation_meters, slope_percent,
            geometry, source_url, raw_properties, collected_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($6), $10), 4326), $7, $8::jsonb, $9
          )
          ON CONFLICT (source, source_feature_id) DO UPDATE SET
            feature_type = EXCLUDED.feature_type,
            elevation_meters = EXCLUDED.elevation_meters,
            slope_percent = EXCLUDED.slope_percent,
            geometry = EXCLUDED.geometry,
            source_url = EXCLUDED.source_url,
            raw_properties = EXCLUDED.raw_properties,
            collected_at = EXCLUDED.collected_at
        `,
        [
          options.source,
          String(id),
          featureType,
          Number.isFinite(elevation) ? elevation : null,
          Number.isFinite(slope) ? Math.abs(slope) : null,
          JSON.stringify(feature.geometry),
          options.sourceUrl,
          JSON.stringify(properties),
          options.collectedAt,
          options.sourceSrid,
        ],
      );
      accepted += 1;
    }
  });
  return { accepted, rejected };
}

async function run(): Promise<void> {
  const args = argsMap();
  try {
    const result = await importPedestrianAccessibility({
      file: required(args, 'file'),
      source: required(args, 'source'),
      sourceUrl: required(args, 'source-url'),
      sourceSrid: Number(args.get('source-srid') ?? '4326'),
      featureType: args.get('feature-type') as PedestrianAccessibilityFeatureType | undefined,
      featureTypeProperty: args.get('feature-type-property'),
      idProperty: required(args, 'id-property'),
      elevationProperty: args.get('elevation-property'),
      slopeProperty: args.get('slope-property'),
      collectedAt: args.get('collected-at') ?? new Date().toISOString(),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

if (require.main === module) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `Pedestrian accessibility import failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
