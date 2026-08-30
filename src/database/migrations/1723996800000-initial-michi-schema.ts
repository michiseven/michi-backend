import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialMichiSchema1723996800000 implements MigrationInterface {
  name = 'InitialMichiSchema1723996800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "postgis"');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query(`
      CREATE TABLE "trips" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "status" varchar(24) NOT NULL DEFAULT 'generating',
        "travel_date" date NOT NULL,
        "start_time" time NOT NULL,
        "end_time" time NOT NULL,
        "budget_krw" integer,
        "start_area" varchar(120),
        "provider_mode" varchar(8) NOT NULL,
        "total_estimated_cost" integer,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_trips_time_window" CHECK ("end_time" > "start_time"),
        CONSTRAINT "ck_trips_budget" CHECK ("budget_krw" IS NULL OR "budget_krw" >= 0),
        CONSTRAINT "ck_trips_provider_mode" CHECK ("provider_mode" IN ('mock', 'live'))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "trip_preferences" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trip_id" uuid NOT NULL UNIQUE REFERENCES "trips"("id") ON DELETE CASCADE,
        "original_text" text NOT NULL,
        "area" varchar(120),
        "start_time" time NOT NULL,
        "end_time" time NOT NULL,
        "budget_krw" integer,
        "companions" varchar(40),
        "pace" varchar(40),
        "interests" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "preferences" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "avoid" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "parser_mode" varchar(8) NOT NULL,
        "validated_json" jsonb NOT NULL,
        CONSTRAINT "ck_trip_preferences_parser_mode" CHECK ("parser_mode" IN ('mock', 'live'))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "places" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "source" varchar(40) NOT NULL,
        "source_place_id" varchar(255) NOT NULL,
        "name" varchar(255) NOT NULL,
        "category" varchar(120),
        "address" varchar(500),
        "road_address" varchar(500),
        "location" geography(Point, 4326),
        "district" varchar(80),
        "raw_category" varchar(500),
        "raw_payload" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_places_source_source_place_id" UNIQUE ("source", "source_place_id")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_places_location" ON "places" USING GIST ("location")',
    );
    await queryRunner.query(`
      CREATE TABLE "recommendation_results" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trip_id" uuid NOT NULL UNIQUE REFERENCES "trips"("id") ON DELETE CASCADE,
        "algorithm_version" varchar(80) NOT NULL,
        "final_weights" jsonb NOT NULL,
        "candidate_count" integer NOT NULL,
        "generated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "recommendation_scores" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "result_id" uuid NOT NULL REFERENCES "recommendation_results"("id") ON DELETE CASCADE,
        "place_id" uuid NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
        "total" double precision NOT NULL,
        "preference" double precision NOT NULL,
        "crowd" double precision NOT NULL,
        "distance" double precision NOT NULL,
        "time" double precision NOT NULL,
        "budget" double precision NOT NULL,
        "diversity" double precision NOT NULL,
        "area" double precision NOT NULL,
        CONSTRAINT "uq_recommendation_score_result_place" UNIQUE ("result_id", "place_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "trip_stops" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trip_id" uuid NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
        "place_id" uuid NOT NULL REFERENCES "places"("id") ON DELETE RESTRICT,
        "order" integer NOT NULL,
        "arrival_at" timestamptz NOT NULL,
        "leave_at" timestamptz NOT NULL,
        "estimated_stay_minutes" integer NOT NULL,
        "estimated_cost" integer,
        "reason" text NOT NULL,
        "crowd_context" jsonb,
        "score_breakdown" jsonb NOT NULL,
        CONSTRAINT "uq_trip_stops_trip_order" UNIQUE ("trip_id", "order"),
        CONSTRAINT "ck_trip_stops_order" CHECK ("order" > 0),
        CONSTRAINT "ck_trip_stops_time" CHECK ("leave_at" > "arrival_at")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "external_data_snapshots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "provider" varchar(80) NOT NULL,
        "data_kind" varchar(80) NOT NULL,
        "scope" varchar(20) NOT NULL,
        "scope_reference" varchar(255) NOT NULL,
        "source_timestamp" timestamptz,
        "collected_at" timestamptz NOT NULL DEFAULT now(),
        "source_url" varchar(1000),
        "raw_payload" jsonb NOT NULL,
        CONSTRAINT "ck_external_snapshot_scope" CHECK ("scope" IN ('area', 'place', 'market-segment'))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "japanese_market_metrics" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "source" varchar(255) NOT NULL,
        "source_url" varchar(1000) NOT NULL,
        "published_at" date,
        "collected_at" timestamptz NOT NULL DEFAULT now(),
        "segment" varchar(160) NOT NULL,
        "metric" varchar(160) NOT NULL,
        "value" double precision NOT NULL,
        "sample_size" integer,
        "notes" text,
        CONSTRAINT "ck_japanese_metric_sample_size" CHECK ("sample_size" IS NULL OR "sample_size" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "user_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_name" varchar(80) NOT NULL,
        "session_id" varchar(255) NOT NULL,
        "trip_id" uuid REFERENCES "trips"("id") ON DELETE SET NULL,
        "place_id" uuid REFERENCES "places"("id") ON DELETE SET NULL,
        "event_timestamp" timestamptz NOT NULL,
        "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query('CREATE INDEX "idx_user_events_trip_id" ON "user_events" ("trip_id")');
    await queryRunner.query(
      'CREATE INDEX "idx_user_events_session_id" ON "user_events" ("session_id")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "user_events"');
    await queryRunner.query('DROP TABLE IF EXISTS "japanese_market_metrics"');
    await queryRunner.query('DROP TABLE IF EXISTS "external_data_snapshots"');
    await queryRunner.query('DROP TABLE IF EXISTS "trip_stops"');
    await queryRunner.query('DROP TABLE IF EXISTS "recommendation_scores"');
    await queryRunner.query('DROP TABLE IF EXISTS "recommendation_results"');
    await queryRunner.query('DROP INDEX IF EXISTS "idx_places_location"');
    await queryRunner.query('DROP TABLE IF EXISTS "places"');
    await queryRunner.query('DROP TABLE IF EXISTS "trip_preferences"');
    await queryRunner.query('DROP TABLE IF EXISTS "trips"');
  }
}
