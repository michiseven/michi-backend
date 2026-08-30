import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { Place, PlaceDescriptionTranslation } from './entities';
import { PlaceDescriptionTranslationService } from '../place-details/place-description-translation.service';

interface BackfillOptions {
  limit: number | null;
  concurrency: number;
}

interface BackfillSummary {
  eligible: number;
  attempted: number;
  translated: number;
  unresolved: number;
  remaining: number;
}

function positiveArgument(name: string, fallback: number | null): number | null {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function options(): BackfillOptions {
  const limit = positiveArgument('limit', null);
  const concurrency = positiveArgument('concurrency', 3);
  if (concurrency === null || concurrency > 10) {
    throw new Error('concurrency must be between 1 and 10');
  }
  return { limit, concurrency };
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= values.length) return;
      await task(values[current]!);
    }
  });
  await Promise.all(workers);
}

async function countMissing(dataSource: DataSource): Promise<number> {
  const rows = await dataSource.query<Array<{ count: string }>>(`
    SELECT count(*)::text AS count
    FROM places p
    WHERE p.source <> 'mock-place'
      AND (
        SELECT count(DISTINCT t.locale)
        FROM place_description_translations t
        WHERE t.place_id = p.id
      ) < 2
  `);
  return Number(rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  const config = options();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const dataSource = app.get(DataSource);
    const places = dataSource.getRepository(Place);
    const translations = dataSource.getRepository(PlaceDescriptionTranslation);
    const service = app.get(PlaceDescriptionTranslationService);

    const ignoredMockPlaces = await places.count({ where: { source: 'mock-place' } });
    const realEligible = (await places.count()) - ignoredMockPlaces;
    const missingPlaces = await places
      .createQueryBuilder('p')
      .where("p.source <> 'mock-place'")
      .andWhere(
        `(SELECT count(DISTINCT t.locale) FROM place_description_translations t WHERE t.place_id = p.id) < 2`,
      )
      .orderBy('p.id', 'ASC')
      .take(config.limit ?? realEligible)
      .getMany();

    const summary: BackfillSummary = {
      eligible: realEligible,
      attempted: 0,
      translated: 0,
      unresolved: 0,
      remaining: 0,
    };

    await mapWithConcurrency(missingPlaces, config.concurrency, async (place) => {
      summary.attempted += 1;
      const before = await translations.count({ where: { placeId: place.id } });
      const localized = await service.ensureForPlaces([place]);
      const after = await translations.count({ where: { placeId: place.id } });
      if (localized.has(place.id) && after >= 2) {
        summary.translated += 1;
      } else if (after <= before) {
        summary.unresolved += 1;
      }
      if (summary.attempted % 25 === 0) {
        process.stdout.write(
          `${JSON.stringify({ progress: summary.attempted, translated: summary.translated, unresolved: summary.unresolved })}\n`,
        );
      }
    });

    summary.remaining = await countMissing(dataSource);
    process.stdout.write(`${JSON.stringify({ ...summary, ignoredMockPlaces }, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Place description backfill failed: ${message}\n`);
  process.exitCode = 1;
});
