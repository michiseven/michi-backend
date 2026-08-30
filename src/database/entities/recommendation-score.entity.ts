import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Place } from './place.entity';
import { RecommendationResult } from './recommendation-result.entity';

@Entity({ name: 'recommendation_scores' })
@Unique('uq_recommendation_score_result_place', ['resultId', 'placeId'])
export class RecommendationScore {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'result_id', type: 'uuid' })
  resultId!: string;

  @ManyToOne(() => RecommendationResult, (result) => result.scores, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'result_id',
    foreignKeyConstraintName: 'recommendation_scores_result_id_fkey',
  })
  result!: RecommendationResult;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId!: string;

  @ManyToOne(() => Place, (place) => place.recommendationScores, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'place_id',
    foreignKeyConstraintName: 'recommendation_scores_place_id_fkey',
  })
  place!: Place;

  @Column({ type: 'double precision' })
  total!: number;

  @Column({ type: 'double precision' })
  preference!: number;

  @Column({ type: 'double precision' })
  crowd!: number;

  @Column({ type: 'double precision' })
  distance!: number;

  @Column({ type: 'double precision' })
  time!: number;

  @Column({ type: 'double precision' })
  budget!: number;

  @Column({ type: 'double precision' })
  diversity!: number;

  @Column({ type: 'double precision' })
  area!: number;

  @Column({ name: 'feature_breakdown', type: 'jsonb', default: {} })
  featureBreakdown!: Record<string, number | null>;

  @Column({ name: 'feature_lineage', type: 'jsonb', default: [] })
  featureLineage!: Record<string, unknown>[];
}
