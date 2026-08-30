import { config } from 'dotenv';
import { verifyPostgisCandidates } from './postgis-candidates';

config({ path: ['.env', 'backend/.env'], quiet: true });

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length)
      .trim() || fallback
  );
}

void verifyPostgisCandidates(process.env, argument('area', '성수'))
  .then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`PostGIS candidate verification failed: ${message}\n`);
    process.exitCode = 1;
  });
