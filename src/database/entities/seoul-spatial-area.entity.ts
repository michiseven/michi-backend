import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { GeoGeometry, GeoPoint } from './entity-types';

export type SeoulSpatialAreaKind = 'administrative_dong' | 'crowd_observation';

@Entity({ name: 'seoul_spatial_areas' })
@Unique('uq_seoul_spatial_areas_source_identity', ['source', 'areaKind', 'sourceAreaId'])
@Index('idx_seoul_spatial_areas_kind_name', ['areaKind', 'name'])
export class SeoulSpatialArea {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  source!: string;

  @Column({ name: 'source_area_id', type: 'varchar', length: 120 })
  sourceAreaId!: string;

  @Column({ name: 'area_kind', type: 'varchar', length: 40 })
  areaKind!: SeoulSpatialAreaKind;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  district!: string | null;

  @Column({ type: 'jsonb', default: [] })
  aliases!: string[];

  @Column({ type: 'geometry', spatialFeatureType: 'Geometry', srid: 4326 })
  @Index('idx_seoul_spatial_areas_geometry', { spatial: true })
  geometry!: GeoGeometry;

  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  @Index('idx_seoul_spatial_areas_centroid', { spatial: true })
  centroid!: GeoPoint;

  @Column({ name: 'source_url', type: 'varchar', length: 1000 })
  sourceUrl!: string;

  @Column({ name: 'raw_metadata', type: 'jsonb', default: {} })
  rawMetadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
