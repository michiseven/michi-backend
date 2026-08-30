import { Check, Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Trip } from './trip.entity';

@Entity({ name: 'trip_preferences' })
@Check('ck_trip_preferences_parser_mode', "\"parser_mode\" IN ('mock', 'live')")
export class TripPreference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'trip_id', type: 'uuid', unique: true })
  tripId!: string;

  @OneToOne(() => Trip, (trip) => trip.preference, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trip_id', foreignKeyConstraintName: 'trip_preferences_trip_id_fkey' })
  trip!: Trip;

  @Column({ name: 'original_text', type: 'text' })
  originalText!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  area!: string | null;

  @Column({ name: 'start_time', type: 'time' })
  startTime!: string;

  @Column({ name: 'end_time', type: 'time' })
  endTime!: string;

  @Column({ name: 'budget_krw', type: 'integer', nullable: true })
  budgetKrw!: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  companions!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  pace!: string | null;

  @Column({ type: 'jsonb', default: [] })
  interests!: string[];

  @Column({ type: 'jsonb', default: [] })
  preferences!: string[];

  @Column({ type: 'jsonb', default: [] })
  avoid!: string[];

  @Column({ name: 'parser_mode', type: 'varchar', length: 8 })
  parserMode!: 'mock' | 'live';

  @Column({ name: 'validated_json', type: 'jsonb' })
  validatedJson!: Record<string, unknown>;
}
