import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEvidenceControlledBenchmark1723996809000 implements MigrationInterface {
  name = 'AddEvidenceControlledBenchmark1723996809000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recommendation_evaluations"
      ADD COLUMN IF NOT EXISTS "evidence_controlled_benchmark" jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recommendation_evaluations"
      DROP COLUMN IF EXISTS "evidence_controlled_benchmark"
    `);
  }
}
