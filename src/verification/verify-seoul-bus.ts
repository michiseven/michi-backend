import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { validateEnvironment } from '../common/config/env.validation';
import { DistanceBasedRoutingProvider } from '../routing/distance-based-routing.provider';
import { SeoulBusRoutingProvider } from '../routing/seoul-bus-routing.provider';
import { TransitStationService } from '../transit/transit-station.service';
import { DataSource } from 'typeorm';
import { TransitStation } from '../database/entities';

async function run(): Promise<void> {
  config({ path: ['.env', '../.env'], quiet: true });
  const values = validateEnvironment({
    ...process.env,
    SEOUL_BUS_PROVIDER_MODE: process.env.SEOUL_BUS_PROVIDER_MODE ?? 'mock',
  });

  const fallback = new DistanceBasedRoutingProvider();
  const dataSource = new DataSource({
    type: 'postgres',
    url: values.DATABASE_URL as string,
    entities: [TransitStation],
    ssl: values.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await dataSource.initialize();
  const transitStations = new TransitStationService(
    dataSource.getRepository(TransitStation),
    new ConfigService(values),
  );
  const provider = new SeoulBusRoutingProvider(
    new ConfigService(values),
    fallback,
    transitStations,
  );

  // Gongdeok coordinate
  const origin = {
    type: 'Point' as const,
    coordinates: [126.951592, 37.54322] as [number, number],
  };
  const destination = {
    type: 'Point' as const,
    coordinates: [126.985474, 37.576477] as [number, number],
  };

  const legResult = await provider.measureLeg(origin, destination, 'bus');
  const nearbyStops = await provider.getNearbyBusStops(origin, 500);
  if (provider.mode === 'live' && nearbyStops.length === 0) {
    throw new Error(
      'LIVE 버스 정류장 검색 결과가 0건입니다. 공식 정류장 동기화 상태를 확인하세요.',
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        provider: provider.name,
        mode: provider.mode,
        legMethod: legResult.method,
        evidence: legResult.evidence,
        transportMode: legResult.transportMode,
        durationMinutes: legResult.durationMinutes,
        disclaimer: legResult.disclaimer,
        nearbyStopsCount: nearbyStops.length,
        firstStop: nearbyStops[0] ?? null,
      },
      null,
      2,
    )}\n`,
  );
  await dataSource.destroy();
}

run().catch((error: unknown) => {
  process.stderr.write(
    `Seoul Bus verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
