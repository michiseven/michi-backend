type ChatThread = { threadId: string; threadSecret: string };
type ChatResponse = {
  status: string;
  responseMessage: string;
  resultTrip?: { id: string; stops?: unknown[] } | null;
  actionChips?: Array<{ label: string; query: string; type?: string }>;
};

const baseUrl = (
  process.env.MICHI_API_BASE_URL ?? 'https://michi.124-111-245-7.sslip.io/michi/api'
).replace(/\/$/, '');

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok)
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function createThread(locale: 'ko' | 'ja'): Promise<ChatThread> {
  return request('/chat/threads', { method: 'POST', body: JSON.stringify({ locale }) });
}

async function send(
  thread: ChatThread,
  message: string,
  locale: 'ko' | 'ja',
): Promise<ChatResponse> {
  return request(`/chat/threads/${thread.threadId}/messages`, {
    method: 'POST',
    headers: { 'X-Thread-Secret': thread.threadSecret },
    body: JSON.stringify({ message, locale, startFreshTrip: true, profilePolicy: 'ignore' }),
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const heritageThread = await createThread('ko');
  const heritage = await send(
    heritageThread,
    '종로에서 고즈넉한 한옥 전통찻집과 역사적인 산책길을 걷고 싶어요.',
    'ko',
  );
  assert(heritage.resultTrip?.id, 'heritage request did not create a trip');
  assert((heritage.resultTrip.stops?.length ?? 0) > 0, 'heritage trip has no stops');

  const mealThread = await createThread('ko');
  const mealQuestion = await send(mealThread, '종로에서 점심을 먹고 한옥을 보고 싶어요.', 'ko');
  assert(!mealQuestion.resultTrip, 'unspecified meal cuisine should ask before trip creation');
  assert(
    (mealQuestion.actionChips ?? []).some((chip) => chip.type === 'meal'),
    'meal choices were not returned',
  );

  const mealTrip = await send(mealThread, '한식으로 추천해줘', 'ko');
  assert(mealTrip.resultTrip?.id, 'meal choice did not create a trip');

  const defaultThread = await createThread('ja');
  const defaultTrip = await send(defaultThread, 'ソウル旅行をおすすめして', 'ja');
  assert(defaultTrip.resultTrip?.id, 'Japanese default request did not create a trip');

  console.log(
    JSON.stringify(
      {
        status: 'passed',
        scenarios: {
          heritage: heritage.resultTrip.id,
          mealChoice: mealTrip.resultTrip.id,
          japaneseDefault: defaultTrip.resultTrip.id,
        },
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
