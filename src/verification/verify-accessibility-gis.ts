import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { validateEnvironment } from '../common/config/env.validation';
import dataSource from '../database/data-source';
import { PedestrianAccessibilityService } from '../routing/pedestrian-accessibility.service';

async function run(): Promise<void> {
  config({ path: ['.env', '../.env'], quiet: true });
  const values = validateEnvironment(process.env);
  await dataSource.initialize();
  try {
    const rows = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM pedestrian_accessibility_features',
    );
    const evidence = await new PedestrianAccessibilityService(
      dataSource,
      new ConfigService(values),
    ).evaluateLeg(
      { type: 'Point', coordinates: [126.9519, 37.5445] },
      { type: 'Point', coordinates: [126.977, 37.5796] },
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          featureCount: Number(rows[0]?.count ?? 0),
          status: evidence.status,
          risk: evidence.risk,
          sourceCount: evidence.sourceRefs.length,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(
    `Accessibility GIS verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
