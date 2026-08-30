import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTripStopTypeAndRainFallback1723996805000 implements MigrationInterface {
  name = 'AddTripStopTypeAndRainFallback1723996805000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_stops"
      ADD COLUMN IF NOT EXISTS "stop_type" varchar(32) NOT NULL DEFAULT 'general',
      ADD COLUMN IF NOT EXISTS "rain_fallback_place_id" uuid,
      ADD CONSTRAINT "trip_stops_rain_fallback_place_id_fkey"
        FOREIGN KEY ("rain_fallback_place_id") REFERENCES "places"("id") ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_stops"
      DROP CONSTRAINT IF EXISTS "trip_stops_rain_fallback_place_id_fkey",
      DROP COLUMN IF EXISTS "rain_fallback_place_id",
      DROP COLUMN IF EXISTS "stop_type"
    `);
  }
}
