import { config } from 'dotenv';
import { verifyKakaoConnection } from './kakao-connection';

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

void verifyKakaoConnection(process.env, argument('area', '공덕'), argument('query', '카페'))
  .then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Kakao connection verification failed: ${message}\n`);
    process.exitCode = 1;
  });
