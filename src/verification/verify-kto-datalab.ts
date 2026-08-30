import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import {
  KTO_DATALAB_CONCENTRATION_DATASET_URL,
  KtoDataLabConcentrationProvider,
  SEOUL_DATALAB_DISTRICTS,
} from '../tourism-data/kto-datalab-concentration.provider';

function districtName(): string {
  const prefix = '--district=';
  return (
    process.argv
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length)
      .trim() || '종로구'
  );
}

async function main(): Promise<void> {
  const requested = districtName();
  const district = SEOUL_DATALAB_DISTRICTS.find((candidate) => candidate.name === requested);
  if (!district) throw new Error(`Unsupported Seoul district: ${requested}`);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const result = await app.get(KtoDataLabConcentrationProvider).fetchDistrict(district);
    const dates = result.records.map((record) => record.forecastDate).sort();
    process.stdout.write(
      `${JSON.stringify(
        {
          provider: 'kto-datalab-concentration',
          datasetUrl: KTO_DATALAB_CONCENTRATION_DATASET_URL,
          authenticated: true,
          district: result.district,
          totalAvailable: result.totalAvailable,
          accepted: result.records.length,
          rejected: result.rejectedCount,
          uniqueAttractions: new Set(result.records.map((record) => record.attractionName)).size,
          referencePeriod: dates.length > 0 ? `${dates[0]}~${dates.at(-1)}` : null,
          scale: 'relative_index_0_100',
          caveat: '실측 방문자 수나 실시간 혼잡도가 아닌 향후 30일 상대 예측 지수',
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `KTO DataLab verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
