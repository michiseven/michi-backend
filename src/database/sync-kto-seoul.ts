import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { KtoSeoulSyncService } from '../providers/place/kto-seoul-sync.service';

function positiveArgument(name: string): number | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const summary = await app.get(KtoSeoulSyncService).synchronize({
      pageSize: positiveArgument('page-size'),
      maxPages: positiveArgument('max-pages'),
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`KTO Seoul sync failed: ${message}\n`);
  process.exitCode = 1;
});
