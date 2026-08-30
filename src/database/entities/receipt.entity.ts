import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ReceiptItem } from './receipt-item.entity';
import { Trip } from './trip.entity';
import { Visit } from './visit.entity';

@Entity({ name: 'receipts' })
@Check('ck_receipts_extractor_mode', `"extractor_mode" IN ('mock', 'live')`)
@Check('ck_receipts_total_amount', '"total_amount_krw" IS NULL OR "total_amount_krw" >= 0')
@Index('idx_receipts_trip_id', ['tripId'])
export class Receipt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'trip_id', type: 'uuid', nullable: true })
  tripId!: string | null;

  @ManyToOne(() => Trip, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'trip_id', foreignKeyConstraintName: 'receipts_trip_id_fkey' })
  trip!: Trip | null;

  @Column({ type: 'varchar', length: 80 })
  extractor!: string;

  @Column({ name: 'extractor_mode', type: 'varchar', length: 8 })
  extractorMode!: 'mock' | 'live';

  @Column({ name: 'merchant_name', type: 'varchar', length: 255, nullable: true })
  merchantName!: string | null;

  @Column({ name: 'merchant_address', type: 'varchar', length: 500, nullable: true })
  merchantAddress!: string | null;

  @Column({ name: 'purchase_date', type: 'date', nullable: true })
  purchaseDate!: string | null;

  @Column({ name: 'purchase_time', type: 'time', nullable: true })
  purchaseTime!: string | null;

  @Column({ name: 'total_amount_krw', type: 'integer', nullable: true })
  totalAmountKrw!: number | null;

  @Column({ type: 'char', length: 3, default: 'KRW' })
  currency!: 'KRW';

  @Column({ name: 'extraction_warnings', type: 'jsonb', default: [] })
  extractionWarnings!: string[];

  @OneToMany(() => ReceiptItem, (item) => item.receipt, { cascade: true })
  items!: ReceiptItem[];

  @OneToOne(() => Visit, (visit) => visit.receipt)
  visit!: Visit | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
