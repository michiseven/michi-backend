import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoutingAndAccessibilityEvidence1723996806000 implements MigrationInterface {
  name = 'AddRoutingAndAccessibilityEvidence1723996806000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "pedestrian_accessibility_features" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "source" varchar(120) NOT NULL,
        "source_feature_id" varchar(240) NOT NULL,
        "feature_type" varchar(32) NOT NULL,
        "elevation_meters" double precision,
        "slope_percent" double precision,
        "geometry" geometry(Geometry, 4326) NOT NULL,
        "source_url" varchar(1000) NOT NULL,
        "raw_properties" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "collected_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pedestrian_accessibility_features_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "uq_accessibility_feature_source_id" UNIQUE ("source", "source_feature_id"),
        CONSTRAINT "ck_accessibility_feature_type" CHECK (
          "feature_type" IN ('elevation_point', 'contour', 'stairs', 'steep_segment')
        ),
        CONSTRAINT "ck_accessibility_slope" CHECK (
          "slope_percent" IS NULL OR "slope_percent" >= 0
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_accessibility_feature_geometry"
      ON "pedestrian_accessibility_features" USING GIST ("geometry")
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_stops"
      ADD COLUMN "inbound_route" jsonb,
      ADD COLUMN "accessibility_context" jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trip_stops" DROP COLUMN "accessibility_context"`);
    await queryRunner.query(`ALTER TABLE "trip_stops" DROP COLUMN "inbound_route"`);
    await queryRunner.query(`DROP INDEX "idx_accessibility_feature_geometry"`);
    await queryRunner.query(`DROP TABLE "pedestrian_accessibility_features"`);
  }
}
