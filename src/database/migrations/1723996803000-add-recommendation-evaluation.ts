import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecommendationEvaluation1723996803000 implements MigrationInterface {
  name = 'AddRecommendationEvaluation1723996803000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recommendation_scores" ADD "feature_breakdown" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "recommendation_scores" ADD "feature_lineage" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(`ALTER TABLE "trip_stops" ADD "tourism_evidence" jsonb`);
    await queryRunner.query(`
      CREATE TABLE "recommendation_evaluations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "scenario_key" character varying(120),
        "preference_snapshot" jsonb NOT NULL,
        "candidate_snapshot" jsonb NOT NULL,
        "data_mode" character varying(16) NOT NULL,
        "baseline_algorithm_version" character varying(160) NOT NULL,
        "michi_algorithm_version" character varying(160) NOT NULL,
        "baseline_metrics" jsonb NOT NULL,
        "michi_metrics" jsonb NOT NULL,
        "delta" jsonb NOT NULL,
        "source_snapshot" jsonb NOT NULL DEFAULT '[]',
        "random_seed" integer,
        "generated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "ck_recommendation_evaluations_data_mode" CHECK ("data_mode" IN ('live', 'mock', 'mixed', 'unavailable')),
        CONSTRAINT "PK_recommendation_evaluations" PRIMARY KEY ("id")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "recommendation_evaluations"`);
    await queryRunner.query(`ALTER TABLE "trip_stops" DROP COLUMN "tourism_evidence"`);
    await queryRunner.query(`ALTER TABLE "recommendation_scores" DROP COLUMN "feature_lineage"`);
    await queryRunner.query(`ALTER TABLE "recommendation_scores" DROP COLUMN "feature_breakdown"`);
  }
}
