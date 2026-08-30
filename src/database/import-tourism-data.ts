import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TourismDataImportService } from '../tourism-data/tourism-data-import.service';

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function formatArgument(value: string | undefined): 'csv' | 'json' | undefined {
  if (value === undefined || value === 'csv' || value === 'json') return value;
  throw new Error('--format must be csv or json');
}

async function main(): Promise<void> {
  const fileArgument = argument('file');
  if (!fileArgument) {
    throw new Error(
      'Usage: npm run import:tourism -- --file=/absolute/path/data.csv [--format=csv] [--encoding=utf-8] [--reject-report=path.json]',
    );
  }
  const filePath = resolve(fileArgument);
  const bytes = await readFile(filePath);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const summary = await app.get(TourismDataImportService).importBuffer({
      fileName: basename(filePath),
      bytes,
      format: formatArgument(argument('format')),
      encoding: argument('encoding'),
    });
    const rejectReport = argument('reject-report');
    if (rejectReport) {
      const reportPath = resolve(rejectReport);
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(
        reportPath,
        `${JSON.stringify(
          {
            importRunId: summary.importRunId,
            datasetKey: summary.datasetKey,
            fileName: summary.fileName,
            rejected: summary.rejected,
            rejections: summary.rejections,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Tourism data import failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
