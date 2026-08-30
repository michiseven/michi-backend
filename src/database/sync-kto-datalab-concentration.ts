import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { KtoDataLabConcentrationSyncService } from '../tourism-data/kto-datalab-concentration-sync.service';

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function pageSize(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 10_000) {
    throw new Error('--page-size must be an integer between 1 and 10000');
  }
  return parsed;
}

async function main(): Promise<void> {
  const district = argument('district')?.trim();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const summary = await app.get(KtoDataLabConcentrationSyncService).synchronize({
      districtNames: district ? [district] : undefined,
      pageSize: pageSize(argument('page-size')),
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `KTO DataLab concentration sync failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
