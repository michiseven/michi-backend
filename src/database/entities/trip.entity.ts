import {
  Column,
  Check,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ProviderMode, TripStatus } from './entity-types';
import { RecommendationResult } from './recommendation-result.entity';
import { TripPreference } from './trip-preference.entity';
import { TripStop } from './trip-stop.entity';

@Entity({ name: 'trips' })
@Check('ck_trips_time_window', '"end_time" > "start_time"')
@Check('ck_trips_budget', '"budget_krw" IS NULL OR "budget_krw" >= 0')
@Check('ck_trips_provider_mode', "\"provider_mode\" IN ('mock', 'live')")
export class Trip {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 24, default: 'generating' })
  status!: TripStatus;

  @Column({ name: 'travel_date', type: 'date' })
  travelDate!: string;

  @Column({ name: 'start_time', type: 'time' })
  startTime!: string;

  @Column({ name: 'end_time', type: 'time' })
  endTime!: string;

  @Column({ name: 'budget_krw', type: 'integer', nullable: true })
  budgetKrw!: number | null;

  @Column({ name: 'start_area', type: 'varchar', length: 120, nullable: true })
  startArea!: string | null;

  @Column({ name: 'provider_mode', type: 'varchar', length: 8 })
  providerMode!: ProviderMode;

  @Column({ name: 'total_estimated_cost', type: 'integer', nullable: true })
  totalEstimatedCost!: number | null;

  @Column({ name: 'edit_token', type: 'varchar', length: 64, nullable: true })
  editToken!: string | null;

  @OneToOne(() => TripPreference, (preference) => preference.trip, {
    cascade: true,
  })
  preference!: TripPreference;

  @OneToMany(() => TripStop, (stop) => stop.trip, { cascade: true })
  stops!: TripStop[];

  @OneToOne(() => RecommendationResult, (result) => result.trip, {
    cascade: true,
  })
  recommendationResult!: RecommendationResult;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
