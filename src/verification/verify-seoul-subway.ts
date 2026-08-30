import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { validateEnvironment } from '../common/config/env.validation';
import { DistanceBasedRoutingProvider } from '../routing/distance-based-routing.provider';
import { SeoulSubwayRoutingProvider } from '../routing/seoul-subway-routing.provider';
import { TransitStationService } from '../transit/transit-station.service';
import { DataSource } from 'typeorm';
import { TransitStation, type GeoPoint } from '../database/entities';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length)
      .trim() ?? null
  );
}

function pointArgument(name: string, fallback: [number, number]): GeoPoint {
  const raw = argument(name);
  if (!raw) return { type: 'Point' as const, coordinates: fallback };
  const [longitude, latitude] = raw.split(',').map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error(`--${name}=longitude,latitude 형식으로 입력해야 합니다.`);
  }
  return {
    type: 'Point' as const,
    coordinates: [longitude!, latitude!] as [number, number],
  };
}

async function run(): Promise<void> {
  config({ path: ['.env', '../.env'], quiet: true });
  const values = validateEnvironment({
    ...process.env,
    SEOUL_SUBWAY_PROVIDER_MODE: process.env.SEOUL_SUBWAY_PROVIDER_MODE ?? 'live',
  });

  const dataSource = new DataSource({
    type: 'postgres',
    url: values.DATABASE_URL as string,
    entities: [TransitStation],
    ssl: values.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await dataSource.initialize();
  const transitStationService = new TransitStationService(
    dataSource.getRepository(TransitStation),
    new ConfigService(values),
  );
  const fallback = new DistanceBasedRoutingProvider();
  const provider = new SeoulSubwayRoutingProvider(
    new ConfigService(values),
    transitStationService,
    fallback,
  );

  // Example leg: Gongdeok (126.951592, 37.543220) -> Anguk (126.985474, 37.576477)
  const origin = pointArgument('origin', [126.951592, 37.54322]);
  const destination = pointArgument('destination', [126.985474, 37.576477]);

  const result = await provider.measureLeg(origin, destination, 'subway', {
    travelDate: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
    departureTime: new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date()),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        authenticated: true,
        provider: provider.name,
        mode: provider.mode,
        method: result.method,
        evidence: result.evidence,
        transportMode: result.transportMode,
        totalDurationMinutes: result.durationMinutes,
        totalDistanceKm: result.distanceKm,
        subwayDetails: result.subwayDetails
          ? {
              departureStation: result.subwayDetails.departureStation,
              arrivalStation: result.subwayDetails.arrivalStation,
              subwayDurationMinutes: result.subwayDetails.subwayDurationMinutes,
              subwayDistanceKm: result.subwayDetails.subwayDistanceKm,
              fareKrw: result.subwayDetails.fareKrw,
              transferCount: result.subwayDetails.transferCount,
              accessWalkMinutes: result.subwayDetails.accessWalkMinutes,
              egressWalkMinutes: result.subwayDetails.egressWalkMinutes,
            }
          : null,
      },
      null,
      2,
    )}\n`,
  );
  await dataSource.destroy();
}

run().catch((error: unknown) => {
  process.stderr.write(
    `Seoul Subway verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
