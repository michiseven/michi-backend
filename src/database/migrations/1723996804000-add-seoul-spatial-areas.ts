import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSeoulSpatialAreas1723996804000 implements MigrationInterface {
  name = 'AddSeoulSpatialAreas1723996804000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "seoul_spatial_areas" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "source" varchar(80) NOT NULL,
        "source_area_id" varchar(120) NOT NULL,
        "area_kind" varchar(40) NOT NULL,
        "name" varchar(120) NOT NULL,
        "district" varchar(80),
        "aliases" jsonb NOT NULL DEFAULT '[]',
        "geometry" geometry(Geometry, 4326) NOT NULL,
        "centroid" geography(Point, 4326) NOT NULL,
        "source_url" varchar(1000) NOT NULL,
        "raw_metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_seoul_spatial_areas" PRIMARY KEY ("id"),
        CONSTRAINT "uq_seoul_spatial_areas_source_identity"
          UNIQUE ("source", "area_kind", "source_area_id"),
        CONSTRAINT "ck_seoul_spatial_areas_kind"
          CHECK ("area_kind" IN ('administrative_dong', 'crowd_observation')),
        CONSTRAINT "ck_seoul_spatial_areas_geometry_type"
          CHECK (GeometryType("geometry") IN ('POINT', 'POLYGON', 'MULTIPOLYGON'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_seoul_spatial_areas_kind_name" ON "seoul_spatial_areas" ("area_kind", "name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_seoul_spatial_areas_geometry" ON "seoul_spatial_areas" USING GIST ("geometry")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_seoul_spatial_areas_centroid" ON "seoul_spatial_areas" USING GIST ("centroid")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "seoul_spatial_areas"`);
  }
}
