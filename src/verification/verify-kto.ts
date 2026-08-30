import { config } from 'dotenv';
import { verifyKtoConnection } from './kto-connection';

config({ path: ['.env', 'backend/.env'], quiet: true });

void verifyKtoConnection(process.env)
  .then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`KTO connection verification failed: ${message}\n`);
    process.exitCode = 1;
  });
