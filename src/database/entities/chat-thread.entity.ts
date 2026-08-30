import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'chat_threads' })
export class ChatThread {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_chat_threads_user_id')
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Index('idx_chat_threads_trip_id')
  @Column({ name: 'trip_id', type: 'uuid', nullable: true })
  tripId!: string | null;

  @Column({ name: 'thread_secret', type: 'varchar', length: 64 })
  threadSecret!: string;

  @Column({ name: 'locale', type: 'varchar', length: 10, default: 'ja' })
  locale!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
