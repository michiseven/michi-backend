import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTourismFeatureStore1723996802000 implements MigrationInterface {
  name = 'AddTourismFeatureStore1723996802000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tourism_data_sources" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "dataset_key" varchar(160) NOT NULL,
        "name" varchar(255) NOT NULL,
        "source_name" varchar(255) NOT NULL,
        "url" varchar(1000) NOT NULL,
        "license_use_condition" text,
        "update_cycle" varchar(120),
        "spatial_granularity" varchar(120) NOT NULL,
        "temporal_granularity" varchar(120) NOT NULL,
        "api_available" boolean NOT NULL DEFAULT false,
        "csv_available" boolean NOT NULL DEFAULT false,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_tourism_data_sources_dataset_key" UNIQUE ("dataset_key")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tourism_import_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "source_id" uuid NOT NULL,
        "file_name" varchar(500) NOT NULL,
        "file_sha256" char(64) NOT NULL,
        "reference_period" varchar(160),
        "mode" varchar(8) NOT NULL,
        "status" varchar(16) NOT NULL,
        "accepted_count" integer NOT NULL DEFAULT 0,
        "rejected_count" integer NOT NULL DEFAULT 0,
        "started_at" timestamptz NOT NULL,
        "completed_at" timestamptz,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT "tourism_import_runs_source_id_fkey"
          FOREIGN KEY ("source_id") REFERENCES "tourism_data_sources"("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_tourism_import_runs_source_sha256" UNIQUE ("source_id", "file_sha256"),
        CONSTRAINT "ck_tourism_import_runs_mode" CHECK ("mode" IN ('live', 'mock')),
        CONSTRAINT "ck_tourism_import_runs_status"
          CHECK ("status" IN ('processing', 'completed', 'failed')),
        CONSTRAINT "ck_tourism_import_runs_counts"
          CHECK ("accepted_count" >= 0 AND "rejected_count" >= 0)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_tourism_import_runs_source_started" ON "tourism_import_runs" ("source_id", "started_at")',
    );

    await queryRunner.query(`
      CREATE TABLE "tourism_metrics" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "source_id" uuid NOT NULL,
        "import_run_id" uuid NOT NULL,
        "place_id" uuid,
        "area_code" varchar(120),
        "area_name" varchar(255),
        "metric_type" varchar(160) NOT NULL,
        "value" double precision NOT NULL,
        "unit" varchar(80) NOT NULL,
        "period_start" date,
        "period_end" date,
        "dimensions" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "dimension_key" char(64) NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "tourism_metrics_source_id_fkey"
          FOREIGN KEY ("source_id") REFERENCES "tourism_data_sources"("id") ON DELETE RESTRICT,
        CONSTRAINT "tourism_metrics_import_run_id_fkey"
          FOREIGN KEY ("import_run_id") REFERENCES "tourism_import_runs"("id") ON DELETE RESTRICT,
        CONSTRAINT "tourism_metrics_place_id_fkey"
          FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE SET NULL,
        CONSTRAINT "uq_tourism_metrics_source_dimension_key"
          UNIQUE ("source_id", "dimension_key"),
        CONSTRAINT "ck_tourism_metrics_subject"
          CHECK ("place_id" IS NOT NULL OR "area_code" IS NOT NULL OR "area_name" IS NOT NULL),
        CONSTRAINT "ck_tourism_metrics_period"
          CHECK ("period_end" IS NULL OR "period_start" IS NULL OR "period_end" >= "period_start")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_tourism_metrics_area_type_period" ON "tourism_metrics" ("area_code", "metric_type", "period_start")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_tourism_metrics_place_type_period" ON "tourism_metrics" ("place_id", "metric_type", "period_start")',
    );

    await queryRunner.query(`
      COMMENT ON TABLE "tourism_import_runs" IS
      'Tracks explicit manual imports. A completed source/file checksum is not imported twice.'
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "tourism_metrics" IS
      'Normalized tourism observations with source, import run, subject, period, and dimensions.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "tourism_metrics"');
    await queryRunner.query('DROP TABLE IF EXISTS "tourism_import_runs"');
    await queryRunner.query('DROP TABLE IF EXISTS "tourism_data_sources"');
  }
}
