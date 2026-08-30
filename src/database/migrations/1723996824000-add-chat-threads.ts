import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatThreads1723996824000 implements MigrationInterface {
  name = 'AddChatThreads1723996824000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_threads" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
        "trip_id" UUID REFERENCES "trips"("id") ON DELETE SET NULL,
        "thread_secret" VARCHAR(64) NOT NULL,
        "locale" VARCHAR(10) NOT NULL DEFAULT 'ja',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS "idx_chat_threads_user_id" ON "chat_threads" ("user_id");
      CREATE INDEX IF NOT EXISTS "idx_chat_threads_trip_id" ON "chat_threads" ("trip_id");
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "chat_threads";
    `);
  }
}
