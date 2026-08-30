import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlacePriceEvidence1723996820000 implements MigrationInterface {
  name = 'AddPlacePriceEvidence1723996820000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "places"
      ADD COLUMN IF NOT EXISTS "estimated_cost_krw" integer,
      ADD COLUMN IF NOT EXISTS "price_evidence" jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "places"
      DROP COLUMN IF EXISTS "price_evidence",
      DROP COLUMN IF EXISTS "estimated_cost_krw"
    `);
  }
}
