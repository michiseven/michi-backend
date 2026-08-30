import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes category/search-derived price guesses introduced by the previous
 * enrichment implementation. Only explicitly verified evidence remains usable.
 */
export class RemoveUnverifiedPlacePrices1723996821000 implements MigrationInterface {
  name = 'RemoveUnverifiedPlacePrices1723996821000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const invalidPricePredicate = `
      p."estimated_cost_krw" IS NOT NULL
      AND (
        p."price_evidence" IS NULL
        OR COALESCE(p."price_evidence"->>'verificationStatus', '') <> 'verified'
        OR COALESCE(p."price_evidence"->>'source', '') NOT IN (
          'kakao-place-menu',
          'kto-detail',
          'manual'
        )
      )
    `;

    await queryRunner.query(`
      UPDATE "trips" AS t
      SET "total_estimated_cost" = NULL
      WHERE EXISTS (
        SELECT 1
        FROM "trip_stops" AS ts
        INNER JOIN "places" AS p ON p."id" = ts."place_id"
        WHERE ts."trip_id" = t."id" AND ${invalidPricePredicate}
      )
    `);

    await queryRunner.query(`
      UPDATE "trip_stops" AS ts
      SET "estimated_cost" = NULL
      FROM "places" AS p
      WHERE p."id" = ts."place_id" AND ${invalidPricePredicate}
    `);

    await queryRunner.query(`
      UPDATE "places" AS p
      SET
        "estimated_cost_krw" = NULL,
        "price_evidence" = NULL
      WHERE ${invalidPricePredicate}
    `);
  }

  async down(): Promise<void> {
    // Deliberately irreversible: removed values were unverified derived data.
  }
}
