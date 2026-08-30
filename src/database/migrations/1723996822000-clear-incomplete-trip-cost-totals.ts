import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Keeps trip totals consistent with the all-stops-known budget contract. */
export class ClearIncompleteTripCostTotals1723996822000 implements MigrationInterface {
  name = 'ClearIncompleteTripCostTotals1723996822000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "trips" AS t
      SET "total_estimated_cost" = NULL
      WHERE t."total_estimated_cost" IS NOT NULL
        AND (
          NOT EXISTS (
            SELECT 1 FROM "trip_stops" AS ts WHERE ts."trip_id" = t."id"
          )
          OR EXISTS (
            SELECT 1
            FROM "trip_stops" AS ts
            WHERE ts."trip_id" = t."id" AND ts."estimated_cost" IS NULL
          )
        )
    `);
  }

  async down(): Promise<void> {
    // Deliberately irreversible: incomplete totals cannot be reconstructed safely.
  }
}
