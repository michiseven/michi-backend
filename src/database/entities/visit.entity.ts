import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Place } from './place.entity';
import { Receipt } from './receipt.entity';

@Entity({ name: 'visits' })
@Check('ck_visits_confirmation_source', `"confirmation_source" = 'user'`)
@Index('idx_visits_place_id', ['placeId'])
export class Visit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'receipt_id', type: 'uuid', unique: true })
  receiptId!: string;

  @OneToOne(() => Receipt, (receipt) => receipt.visit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'receipt_id', foreignKeyConstraintName: 'visits_receipt_id_fkey' })
  receipt!: Receipt;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId!: string;

  @ManyToOne(() => Place, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'place_id', foreignKeyConstraintName: 'visits_place_id_fkey' })
  place!: Place;

  @Column({ name: 'confirmation_source', type: 'varchar', length: 16 })
  confirmationSource!: 'user';

  @Column({ name: 'confirmed_at', type: 'timestamptz' })
  confirmedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
