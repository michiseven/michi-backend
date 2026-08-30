import { Check, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'japanese_market_metrics' })
@Check('ck_japanese_metric_sample_size', '"sample_size" IS NULL OR "sample_size" >= 0')
export class JapaneseMarketMetric {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  source!: string;

  @Column({ name: 'source_url', type: 'varchar', length: 1000 })
  sourceUrl!: string;

  @Column({ name: 'published_at', type: 'date', nullable: true })
  publishedAt!: string | null;

  @CreateDateColumn({ name: 'collected_at', type: 'timestamptz' })
  collectedAt!: Date;

  @Column({ type: 'varchar', length: 160 })
  segment!: string;

  @Column({ type: 'varchar', length: 160 })
  metric!: string;

  @Column({ type: 'double precision' })
  value!: number;

  @Column({ name: 'sample_size', type: 'integer', nullable: true })
  sampleSize!: number | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
