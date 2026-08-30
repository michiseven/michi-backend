import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { validateEnvironment } from '../common/config/env.validation';
import { DistanceBasedRoutingProvider } from '../routing/distance-based-routing.provider';
import { NaverDirectionsRoutingProvider } from '../routing/naver-directions-routing.provider';

async function run(): Promise<void> {
  config({ path: ['.env', '../.env'], quiet: true });
  const values = validateEnvironment({ ...process.env, ROUTING_PROVIDER_MODE: 'live' });
  const provider = new NaverDirectionsRoutingProvider(
    new ConfigService(values),
    new DistanceBasedRoutingProvider(),
  );
  const result = await provider.measureLeg(
    { type: 'Point', coordinates: [126.9519, 37.5445] },
    { type: 'Point', coordinates: [126.977, 37.5796] },
    'taxi',
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        authenticated: true,
        provider: provider.name,
        method: result.method,
        transportMode: result.transportMode,
        distanceKm: result.distanceKm,
        durationMinutes: result.durationMinutes,
        pathPointCount: result.path?.length ?? 0,
      },
      null,
      2,
    )}\n`,
  );
}

run().catch((error: unknown) => {
  process.stderr.write(
    `NAVER Directions verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
