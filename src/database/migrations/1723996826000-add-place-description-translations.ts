import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlaceDescriptionTranslations1723996826000 implements MigrationInterface {
  name = 'AddPlaceDescriptionTranslations1723996826000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "place_description_translations" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "place_id" UUID NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
        "locale" VARCHAR(2) NOT NULL CHECK ("locale" IN ('ko', 'ja')),
        "description" TEXT NOT NULL,
        "provider" VARCHAR(60) NOT NULL,
        "model" VARCHAR(120) NOT NULL,
        "response_id" VARCHAR(255),
        "sources" JSONB NOT NULL,
        "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_place_description_translations_place_locale" UNIQUE ("place_id", "locale")
      );

      CREATE INDEX IF NOT EXISTS "idx_place_description_translations_place_id"
        ON "place_description_translations" ("place_id");
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "place_description_translations";`);
  }
}
