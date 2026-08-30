import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Receipt } from './receipt.entity';

@Entity({ name: 'receipt_items' })
@Unique('uq_receipt_items_receipt_line', ['receiptId', 'lineNumber'])
@Check('ck_receipt_items_line_number', '"line_number" > 0')
@Check('ck_receipt_items_quantity', '"quantity" IS NULL OR "quantity" > 0')
@Check('ck_receipt_items_unit_price', '"unit_price_krw" IS NULL OR "unit_price_krw" >= 0')
@Check('ck_receipt_items_amount', '"amount_krw" IS NULL OR "amount_krw" >= 0')
export class ReceiptItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'receipt_id', type: 'uuid' })
  receiptId!: string;

  @ManyToOne(() => Receipt, (receipt) => receipt.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'receipt_id', foreignKeyConstraintName: 'receipt_items_receipt_id_fkey' })
  receipt!: Receipt;

  @Column({ name: 'line_number', type: 'integer' })
  lineNumber!: number;

  @Column({ name: 'item_name', type: 'varchar', length: 255 })
  itemName!: string;

  @Column({ type: 'integer', nullable: true })
  quantity!: number | null;

  @Column({ name: 'unit_price_krw', type: 'integer', nullable: true })
  unitPriceKrw!: number | null;

  @Column({ name: 'amount_krw', type: 'integer', nullable: true })
  amountKrw!: number | null;
}
