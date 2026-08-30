import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddItineraryExplanations1723996808000 implements MigrationInterface {
  name = 'AddItineraryExplanations1723996808000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recommendation_results"
      ADD COLUMN IF NOT EXISTS "explanation" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_stops"
      ADD COLUMN IF NOT EXISTS "explanation" jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_stops"
      DROP COLUMN IF EXISTS "explanation"
    `);
    await queryRunner.query(`
      ALTER TABLE "recommendation_results"
      DROP COLUMN IF EXISTS "explanation"
    `);
  }
}
