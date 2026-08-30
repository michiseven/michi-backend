import { Check, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'external_data_snapshots' })
@Check('ck_external_snapshot_scope', "\"scope\" IN ('area', 'place', 'market-segment')")
export class ExternalDataSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  provider!: string;

  @Column({ name: 'data_kind', type: 'varchar', length: 80 })
  dataKind!: string;

  @Column({ type: 'varchar', length: 20 })
  scope!: 'area' | 'place' | 'market-segment';

  @Column({ name: 'scope_reference', type: 'varchar', length: 255 })
  scopeReference!: string;

  @Column({ name: 'source_timestamp', type: 'timestamptz', nullable: true })
  sourceTimestamp!: Date | null;

  @CreateDateColumn({ name: 'collected_at', type: 'timestamptz' })
  collectedAt!: Date;

  @Column({ name: 'source_url', type: 'varchar', length: 1000, nullable: true })
  sourceUrl!: string | null;

  @Column({ name: 'raw_payload', type: 'jsonb' })
  rawPayload!: Record<string, unknown>;
}
