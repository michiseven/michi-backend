import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TransitStationService } from './transit-station.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });
  const service = app.get(TransitStationService);
  try {
    const result = await service.syncOfficialStations();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `Failed to sync official transit stations: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void bootstrap();
