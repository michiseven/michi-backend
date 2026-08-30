import { Check, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type EvaluationDataMode = 'live' | 'mock' | 'mixed' | 'unavailable';

@Entity({ name: 'recommendation_evaluations' })
@Check(
  'ck_recommendation_evaluations_data_mode',
  `"data_mode" IN ('live', 'mock', 'mixed', 'unavailable')`,
)
export class RecommendationEvaluation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'scenario_key', type: 'varchar', length: 120, nullable: true })
  scenarioKey!: string | null;

  @Column({ name: 'preference_snapshot', type: 'jsonb' })
  preferenceSnapshot!: Record<string, unknown>;

  @Column({ name: 'candidate_snapshot', type: 'jsonb' })
  candidateSnapshot!: Record<string, unknown>[];

  @Column({ name: 'data_mode', type: 'varchar', length: 16 })
  dataMode!: EvaluationDataMode;

  @Column({ name: 'baseline_algorithm_version', type: 'varchar', length: 160 })
  baselineAlgorithmVersion!: string;

  @Column({ name: 'michi_algorithm_version', type: 'varchar', length: 160 })
  michiAlgorithmVersion!: string;

  @Column({ name: 'baseline_metrics', type: 'jsonb' })
  baselineMetrics!: Record<string, number | null>;

  @Column({ name: 'michi_metrics', type: 'jsonb' })
  michiMetrics!: Record<string, number | null>;

  @Column({ type: 'jsonb' })
  delta!: Record<string, number | null>;

  @Column({ name: 'evidence_controlled_benchmark', type: 'jsonb', nullable: true })
  evidenceControlledBenchmark!: Record<string, unknown> | null;

  @Column({ name: 'source_snapshot', type: 'jsonb', default: [] })
  sourceSnapshot!: Record<string, unknown>[];

  @Column({ name: 'random_seed', type: 'integer', nullable: true })
  randomSeed!: number | null;

  @CreateDateColumn({ name: 'generated_at', type: 'timestamptz' })
  generatedAt!: Date;
}
