import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Place } from './place.entity';
import { TourismDataSource } from './tourism-data-source.entity';
import { TourismImportRun } from './tourism-import-run.entity';

@Entity({ name: 'tourism_metrics' })
@Unique('uq_tourism_metrics_source_dimension_key', ['sourceId', 'dimensionKey'])
@Index('idx_tourism_metrics_area_type_period', ['areaCode', 'metricType', 'periodStart'])
@Index('idx_tourism_metrics_place_type_period', ['placeId', 'metricType', 'periodStart'])
@Check(
  'ck_tourism_metrics_subject',
  '"place_id" IS NOT NULL OR "area_code" IS NOT NULL OR "area_name" IS NOT NULL',
)
@Check(
  'ck_tourism_metrics_period',
  '"period_end" IS NULL OR "period_start" IS NULL OR "period_end" >= "period_start"',
)
export class TourismMetric {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId!: string;

  @ManyToOne(() => TourismDataSource, (source) => source.metrics, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'source_id', foreignKeyConstraintName: 'tourism_metrics_source_id_fkey' })
  source!: TourismDataSource;

  @Column({ name: 'import_run_id', type: 'uuid' })
  importRunId!: string;

  @ManyToOne(() => TourismImportRun, (run) => run.metrics, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'import_run_id',
    foreignKeyConstraintName: 'tourism_metrics_import_run_id_fkey',
  })
  importRun!: TourismImportRun;

  @Column({ name: 'place_id', type: 'uuid', nullable: true })
  placeId!: string | null;

  @ManyToOne(() => Place, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'place_id', foreignKeyConstraintName: 'tourism_metrics_place_id_fkey' })
  place!: Place | null;

  @Column({ name: 'area_code', type: 'varchar', length: 120, nullable: true })
  areaCode!: string | null;

  @Column({ name: 'area_name', type: 'varchar', length: 255, nullable: true })
  areaName!: string | null;

  @Column({ name: 'metric_type', type: 'varchar', length: 160 })
  metricType!: string;

  @Column({ type: 'double precision' })
  value!: number;

  @Column({ type: 'varchar', length: 80 })
  unit!: string;

  @Column({ name: 'period_start', type: 'date', nullable: true })
  periodStart!: string | null;

  @Column({ name: 'period_end', type: 'date', nullable: true })
  periodEnd!: string | null;

  @Column({ type: 'jsonb', default: {} })
  dimensions!: Record<string, unknown>;

  @Column({ name: 'dimension_key', type: 'char', length: 64 })
  dimensionKey!: string;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
