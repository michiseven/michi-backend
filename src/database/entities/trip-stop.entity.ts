import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { CrowdContextSnapshot, ScoreBreakdownSnapshot } from './entity-types';
import { Place } from './place.entity';
import { Trip } from './trip.entity';
import type { TourismPlaceFeatureEvidence } from '../../tourism-feature/tourism-feature.types';
import type { RouteLegEstimate } from '../../routing/routing-provider';
import type { AccessibilityLegEvidence } from '../../routing/accessibility-evidence';

export type TripStopType =
  | 'airport'
  | 'basecamp'
  | 'fixed_appointment'
  | 'meal'
  | 'must_visit'
  | 'general'
  | 'rain_fallback';

@Entity({ name: 'trip_stops' })
@Unique('uq_trip_stops_trip_order', ['tripId', 'order'])
@Check('ck_trip_stops_order', '"order" > 0')
@Check('ck_trip_stops_time', '"leave_at" > "arrival_at"')
export class TripStop {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'trip_id', type: 'uuid' })
  tripId!: string;

  @ManyToOne(() => Trip, (trip) => trip.stops, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trip_id', foreignKeyConstraintName: 'trip_stops_trip_id_fkey' })
  trip!: Trip;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId!: string;

  @ManyToOne(() => Place, (place) => place.tripStops, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'place_id', foreignKeyConstraintName: 'trip_stops_place_id_fkey' })
  place!: Place;

  @Column({ name: 'stop_type', type: 'varchar', length: 32, default: 'general' })
  stopType!: TripStopType;

  @Column({ name: 'rain_fallback_place_id', type: 'uuid', nullable: true })
  rainFallbackPlaceId!: string | null;

  @ManyToOne(() => Place, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'rain_fallback_place_id',
    foreignKeyConstraintName: 'trip_stops_rain_fallback_place_id_fkey',
  })
  rainFallbackPlace!: Place | null;

  @Column({ type: 'integer' })
  order!: number;

  @Column({ name: 'arrival_at', type: 'timestamptz' })
  arrivalAt!: Date;

  @Column({ name: 'leave_at', type: 'timestamptz' })
  leaveAt!: Date;

  @Column({ name: 'estimated_stay_minutes', type: 'integer' })
  estimatedStayMinutes!: number;

  @Column({ name: 'estimated_cost', type: 'integer', nullable: true })
  estimatedCost!: number | null;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ name: 'crowd_context', type: 'jsonb', nullable: true })
  crowdContext!: CrowdContextSnapshot | null;

  @Column({ name: 'score_breakdown', type: 'jsonb' })
  scoreBreakdown!: ScoreBreakdownSnapshot;

  @Column({ name: 'tourism_evidence', type: 'jsonb', nullable: true })
  tourismEvidence!: TourismPlaceFeatureEvidence | null;

  @Column({ name: 'inbound_route', type: 'jsonb', nullable: true })
  inboundRoute!: RouteLegEstimate | null;

  @Column({ name: 'accessibility_context', type: 'jsonb', nullable: true })
  accessibilityContext!: AccessibilityLegEvidence | null;

  @Column({ name: 'explanation', type: 'jsonb', nullable: true })
  explanation!: import('./entity-types').StopExplanation | null;
}
