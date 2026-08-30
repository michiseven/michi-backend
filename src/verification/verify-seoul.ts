import { config } from 'dotenv';
import { verifySeoulConnection } from './seoul-connection';

config({ path: ['.env', 'backend/.env'], quiet: true });

function areaArgument(): string {
  const prefix = '--area=';
  return (
    process.argv
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length)
      .trim() || '성수카페거리'
  );
}

void verifySeoulConnection(process.env, areaArgument())
  .then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Seoul Open Data connection verification failed: ${message}\n`);
    process.exitCode = 1;
  });
