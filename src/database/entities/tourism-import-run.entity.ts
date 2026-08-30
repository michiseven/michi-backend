import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { TourismDataSource } from './tourism-data-source.entity';
import { TourismMetric } from './tourism-metric.entity';

export type TourismImportMode = 'live' | 'mock';
export type TourismImportStatus = 'processing' | 'completed' | 'failed';

@Entity({ name: 'tourism_import_runs' })
@Unique('uq_tourism_import_runs_source_sha256', ['sourceId', 'fileSha256'])
@Index('idx_tourism_import_runs_source_started', ['sourceId', 'startedAt'])
@Check('ck_tourism_import_runs_mode', `"mode" IN ('live', 'mock')`)
@Check('ck_tourism_import_runs_status', `"status" IN ('processing', 'completed', 'failed')`)
@Check('ck_tourism_import_runs_counts', '"accepted_count" >= 0 AND "rejected_count" >= 0')
export class TourismImportRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId!: string;

  @ManyToOne(() => TourismDataSource, (source) => source.importRuns, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'source_id',
    foreignKeyConstraintName: 'tourism_import_runs_source_id_fkey',
  })
  source!: TourismDataSource;

  @Column({ name: 'file_name', type: 'varchar', length: 500 })
  fileName!: string;

  @Column({ name: 'file_sha256', type: 'char', length: 64 })
  fileSha256!: string;

  @Column({ name: 'reference_period', type: 'varchar', length: 160, nullable: true })
  referencePeriod!: string | null;

  @Column({ type: 'varchar', length: 8 })
  mode!: TourismImportMode;

  @Column({ type: 'varchar', length: 16 })
  status!: TourismImportStatus;

  @Column({ name: 'accepted_count', type: 'integer', default: 0 })
  acceptedCount!: number;

  @Column({ name: 'rejected_count', type: 'integer', default: 0 })
  rejectedCount!: number;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @OneToMany(() => TourismMetric, (metric) => metric.importRun)
  metrics!: TourismMetric[];
}
