import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransitStations1723996807000 implements MigrationInterface {
  name = 'AddTransitStations1723996807000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "transit_stations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "source" varchar(80) NOT NULL,
        "transport_mode" varchar(20) NOT NULL,
        "station_code" varchar(80) NOT NULL,
        "station_name" varchar(120) NOT NULL,
        "line" varchar(120) NOT NULL,
        "district" varchar(80),
        "location" geography(Point, 4326) NOT NULL,
        "source_url" varchar(1000),
        "raw_metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transit_stations" PRIMARY KEY ("id"),
        CONSTRAINT "uq_transit_stations_source_code_line"
          UNIQUE ("source", "station_code", "line")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_transit_stations_name" ON "transit_stations" ("station_name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_transit_stations_location" ON "transit_stations" USING GIST ("location")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_transit_stations_mode_location" ON "transit_stations" USING GIST ("location") WHERE "transport_mode" IN ('subway', 'bus')`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "transit_stations"`);
  }
}
