import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { TourismImportRun } from './tourism-import-run.entity';
import { TourismMetric } from './tourism-metric.entity';

@Entity({ name: 'tourism_data_sources' })
@Unique('uq_tourism_data_sources_dataset_key', ['datasetKey'])
export class TourismDataSource {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'dataset_key', type: 'varchar', length: 160 })
  datasetKey!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'source_name', type: 'varchar', length: 255 })
  sourceName!: string;

  @Column({ type: 'varchar', length: 1000 })
  url!: string;

  @Column({ name: 'license_use_condition', type: 'text', nullable: true })
  licenseUseCondition!: string | null;

  @Column({ name: 'update_cycle', type: 'varchar', length: 120, nullable: true })
  updateCycle!: string | null;

  @Column({ name: 'spatial_granularity', type: 'varchar', length: 120 })
  spatialGranularity!: string;

  @Column({ name: 'temporal_granularity', type: 'varchar', length: 120 })
  temporalGranularity!: string;

  @Column({ name: 'api_available', type: 'boolean', default: false })
  apiAvailable!: boolean;

  @Column({ name: 'csv_available', type: 'boolean', default: false })
  csvAvailable!: boolean;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @OneToMany(() => TourismImportRun, (run) => run.source)
  importRuns!: TourismImportRun[];

  @OneToMany(() => TourismMetric, (metric) => metric.source)
  metrics!: TourismMetric[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
