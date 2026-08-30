import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReceiptFoundation1723996801000 implements MigrationInterface {
  name = 'AddReceiptFoundation1723996801000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "receipts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trip_id" uuid,
        "extractor" varchar(80) NOT NULL,
        "extractor_mode" varchar(8) NOT NULL,
        "merchant_name" varchar(255),
        "merchant_address" varchar(500),
        "purchase_date" date,
        "purchase_time" time,
        "total_amount_krw" integer,
        "currency" char(3) NOT NULL DEFAULT 'KRW',
        "extraction_warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "receipts_trip_id_fkey"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL,
        CONSTRAINT "ck_receipts_extractor_mode" CHECK ("extractor_mode" IN ('mock', 'live')),
        CONSTRAINT "ck_receipts_total_amount"
          CHECK ("total_amount_krw" IS NULL OR "total_amount_krw" >= 0)
      )
    `);
    await queryRunner.query('CREATE INDEX "idx_receipts_trip_id" ON "receipts" ("trip_id")');
    await queryRunner.query(`
      COMMENT ON TABLE "receipts" IS
      'Stores redacted structured extraction only; raw OCR text, receipt images, card data, phone numbers, names, and credentials are not persisted.'
    `);

    await queryRunner.query(`
      CREATE TABLE "receipt_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "receipt_id" uuid NOT NULL,
        "line_number" integer NOT NULL,
        "item_name" varchar(255) NOT NULL,
        "quantity" integer,
        "unit_price_krw" integer,
        "amount_krw" integer,
        CONSTRAINT "receipt_items_receipt_id_fkey"
          FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_receipt_items_receipt_line" UNIQUE ("receipt_id", "line_number"),
        CONSTRAINT "ck_receipt_items_line_number" CHECK ("line_number" > 0),
        CONSTRAINT "ck_receipt_items_quantity" CHECK ("quantity" IS NULL OR "quantity" > 0),
        CONSTRAINT "ck_receipt_items_unit_price"
          CHECK ("unit_price_krw" IS NULL OR "unit_price_krw" >= 0),
        CONSTRAINT "ck_receipt_items_amount" CHECK ("amount_krw" IS NULL OR "amount_krw" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "visits" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "receipt_id" uuid NOT NULL UNIQUE,
        "place_id" uuid NOT NULL,
        "confirmation_source" varchar(16) NOT NULL,
        "confirmed_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "visits_receipt_id_fkey"
          FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE CASCADE,
        CONSTRAINT "visits_place_id_fkey"
          FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_visits_confirmation_source" CHECK ("confirmation_source" = 'user')
      )
    `);
    await queryRunner.query('CREATE INDEX "idx_visits_place_id" ON "visits" ("place_id")');
    await queryRunner.query(`
      COMMENT ON TABLE "visits" IS
      'Contains user-confirmed visits only. Place-match candidates and confidence scores do not create visits.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "visits"');
    await queryRunner.query('DROP TABLE IF EXISTS "receipt_items"');
    await queryRunner.query('DROP TABLE IF EXISTS "receipts"');
  }
}
