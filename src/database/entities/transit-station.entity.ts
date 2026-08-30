import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { GeoPoint } from './entity-types';

@Entity({ name: 'transit_stations' })
@Unique('uq_transit_stations_source_code_line', ['source', 'stationCode', 'line'])
@Index('idx_transit_stations_name', ['stationName'])
export class TransitStation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  source!: string;

  @Column({ name: 'transport_mode', type: 'varchar', length: 20 })
  transportMode!: 'subway' | 'bus';

  @Column({ name: 'station_code', type: 'varchar', length: 80 })
  stationCode!: string;

  @Column({ name: 'station_name', type: 'varchar', length: 120 })
  stationName!: string;

  @Column({ type: 'varchar', length: 120 })
  line!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  district!: string | null;

  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  @Index('idx_transit_stations_location', { spatial: true })
  location!: GeoPoint;

  @Column({ name: 'source_url', type: 'varchar', length: 1000, nullable: true })
  sourceUrl!: string | null;

  @Column({ name: 'raw_metadata', type: 'jsonb', default: {} })
  rawMetadata!: Record<string, string | number | boolean | null>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
