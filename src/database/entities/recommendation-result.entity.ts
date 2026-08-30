import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RecommendationScore } from './recommendation-score.entity';
import { Trip } from './trip.entity';

@Entity({ name: 'recommendation_results' })
export class RecommendationResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'trip_id', type: 'uuid', unique: true })
  tripId!: string;

  @OneToOne(() => Trip, (trip) => trip.recommendationResult, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'recommendation_results_trip_id_fkey',
  })
  trip!: Trip;

  @Column({ name: 'algorithm_version', type: 'varchar', length: 80 })
  algorithmVersion!: string;

  @Column({ name: 'final_weights', type: 'jsonb' })
  finalWeights!: Record<string, number>;

  @Column({ name: 'candidate_count', type: 'integer' })
  candidateCount!: number;

  @Column({ name: 'explanation', type: 'jsonb', nullable: true })
  explanation!: import('./entity-types').TripExplanation | null;

  @OneToMany(() => RecommendationScore, (score) => score.result, { cascade: true })
  scores!: RecommendationScore[];

  @CreateDateColumn({ name: 'generated_at', type: 'timestamptz' })
  generatedAt!: Date;
}
