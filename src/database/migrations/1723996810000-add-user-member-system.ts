import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserMemberSystem1723996810000 implements MigrationInterface {
  name = 'AddUserMemberSystem1723996810000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. users 테이블
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "display_name" varchar(100) NOT NULL,
        "email" varchar(255) NOT NULL UNIQUE,
        "password_hash" varchar(255) NOT NULL,
        "locale" varchar(8) NOT NULL DEFAULT 'ja',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_users_locale" CHECK ("locale" IN ('ja', 'ko'))
      )
    `);
    await queryRunner.query('CREATE INDEX "idx_users_email" ON "users" ("email")');

    // 2. user_saved_trips 테이블 (스냅샷 저장 — trips 테이블과 FK 없음)
    await queryRunner.query(`
      CREATE TABLE "user_saved_trips" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "trip_id" uuid NOT NULL,
        "title" varchar(255) NOT NULL DEFAULT '',
        "travel_date" varchar(40) NOT NULL DEFAULT '',
        "stops_count" integer NOT NULL DEFAULT 0,
        "estimated_total_cost" integer,
        "trip_snapshot" jsonb,
        "memo" text,
        "saved_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_user_saved_trips_stops_count" CHECK ("stops_count" >= 0),
        CONSTRAINT "uq_user_saved_trips_user_trip" UNIQUE ("user_id", "trip_id")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_user_saved_trips_user_id" ON "user_saved_trips" ("user_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_user_saved_trips_saved_at" ON "user_saved_trips" ("user_id", "saved_at" DESC)',
    );

    // 3. refresh_tokens 테이블 (Refresh Token rotation 지원)
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash" varchar(255) NOT NULL UNIQUE,
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "revoked_at" timestamptz
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_refresh_tokens_token_hash" ON "refresh_tokens" ("token_hash")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "idx_refresh_tokens_token_hash"');
    await queryRunner.query('DROP INDEX IF EXISTS "idx_refresh_tokens_user_id"');
    await queryRunner.query('DROP TABLE IF EXISTS "refresh_tokens"');
    await queryRunner.query('DROP INDEX IF EXISTS "idx_user_saved_trips_saved_at"');
    await queryRunner.query('DROP INDEX IF EXISTS "idx_user_saved_trips_user_id"');
    await queryRunner.query('DROP TABLE IF EXISTS "user_saved_trips"');
    await queryRunner.query('DROP INDEX IF EXISTS "idx_users_email"');
    await queryRunner.query('DROP TABLE IF EXISTS "users"');
  }
}
