import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlaceDetailEvidences1723996825000 implements MigrationInterface {
  name = 'AddPlaceDetailEvidences1723996825000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "place_detail_evidences" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "place_id" UUID NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
        "provider" VARCHAR(60) NOT NULL,
        "model" VARCHAR(120) NOT NULL,
        "response_id" VARCHAR(255),
        "status" VARCHAR(30) NOT NULL,
        "evidence" JSONB NOT NULL,
        "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS "idx_place_detail_evidences_place_expires"
        ON "place_detail_evidences" ("place_id", "expires_at" DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "place_detail_evidences";`);
  }
}
