import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { GeoGeometry } from './entity-types';

export type PedestrianAccessibilityFeatureType =
  'elevation_point' | 'contour' | 'stairs' | 'steep_segment';

@Entity({ name: 'pedestrian_accessibility_features' })
@Index('uq_accessibility_feature_source_id', ['source', 'sourceFeatureId'], { unique: true })
export class PedestrianAccessibilityFeature {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  source!: string;

  @Column({ name: 'source_feature_id', type: 'varchar', length: 240 })
  sourceFeatureId!: string;

  @Column({ name: 'feature_type', type: 'varchar', length: 32 })
  featureType!: PedestrianAccessibilityFeatureType;

  @Column({ name: 'elevation_meters', type: 'double precision', nullable: true })
  elevationMeters!: number | null;

  @Column({ name: 'slope_percent', type: 'double precision', nullable: true })
  slopePercent!: number | null;

  @Column({ type: 'geometry', spatialFeatureType: 'Geometry', srid: 4326 })
  geometry!: GeoGeometry;

  @Column({ name: 'source_url', type: 'varchar', length: 1_000 })
  sourceUrl!: string;

  @Column({ name: 'raw_properties', type: 'jsonb', default: () => "'{}'::jsonb" })
  rawProperties!: Record<string, unknown>;

  @Column({ name: 'collected_at', type: 'timestamptz' })
  collectedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
