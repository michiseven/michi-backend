import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTripEditToken1723996823000 implements MigrationInterface {
  name = 'AddTripEditToken1723996823000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
      ADD COLUMN IF NOT EXISTS "edit_token" VARCHAR(64);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
      DROP COLUMN IF EXISTS "edit_token";
    `);
  }
}
