import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Place } from './place.entity';
import { Trip } from './trip.entity';

@Entity({ name: 'user_events' })
@Index('idx_user_events_trip_id', ['tripId'])
@Index('idx_user_events_session_id', ['sessionId'])
export class UserEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_name', type: 'varchar', length: 80 })
  eventName!: string;

  @Column({ name: 'session_id', type: 'varchar', length: 255 })
  sessionId!: string;

  @Column({ name: 'trip_id', type: 'uuid', nullable: true })
  tripId!: string | null;

  @ManyToOne(() => Trip, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'trip_id', foreignKeyConstraintName: 'user_events_trip_id_fkey' })
  trip!: Trip | null;

  @Column({ name: 'place_id', type: 'uuid', nullable: true })
  placeId!: string | null;

  @ManyToOne(() => Place, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'place_id', foreignKeyConstraintName: 'user_events_place_id_fkey' })
  place!: Place | null;

  @Column({ name: 'event_timestamp', type: 'timestamptz' })
  eventTimestamp!: Date;

  @Column({ type: 'jsonb', default: {} })
  context!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
