type Locale = 'ko' | 'ja';
export {};
type MealChoice =
  'korean' | 'japanese' | 'chinese' | 'western' | 'cafe_dessert' | 'local_specialty';

type PendingQuestion = {
  id: string;
  revision: number;
  options: Array<{ id: string; mealCuisine?: MealChoice; mealPreference?: MealChoice }>;
};
type ChatResponse = {
  status: string;
  responseMessage: string;
  actionChips?: Array<{
    query: string;
    questionId?: string;
    optionId?: string;
    mealCuisine?: MealChoice;
    mealPreference?: MealChoice;
  }>;
  pendingQuestion?: PendingQuestion | null;
  resultTripId?: string | null;
  resultTrip?: { stops?: Array<{ category: string | null; stopType?: string }> } | null;
  errorCode?: string | null;
};
type Thread = { threadId: string; threadSecret: string };
type Scenario = {
  id: string;
  text: string;
  locale?: Locale;
  mealChoice?: MealChoice;
  expectQuestion?: boolean;
  followGeneralChoice?: boolean;
};

const baseUrl = (process.env.MICHI_API_BASE_URL ?? 'http://127.0.0.1:4000/api').replace(/\/$/, '');
const requestTimeoutMs = Number(process.env.MICHI_SCENARIO_TIMEOUT_MS ?? 30_000);

// Kept in the same order as docs/ux/planner-local-20-scenario-regression-2026-09-10.md.
const scenarios: readonly Scenario[] = [
  {
    id: '01',
    text: '弘大で友達3人、土曜日13〜18時にカフェと夕食を楽しみたい。',
    mealChoice: 'cafe_dessert',
  },
  {
    id: '02',
    text: '弘大で友達3人、土曜日13〜18時にランチ、カフェ、散歩をしたい。',
    mealChoice: 'korean',
  },
  { id: '03', text: '聖水で一人、静かなカフェ巡りをしたい。混雑は避けたい。' },
  { id: '04', text: '初めてのソウルです。景福宮と韓屋を見たい。', followGeneralChoice: true },
  {
    id: '05',
    text: '明洞で家族4人、子どもと歩きすぎない半日コースを作って。',
    mealChoice: 'local_specialty',
  },
  {
    id: '06',
    text: '江南で恋人と夜景が見たい。18時から22時、予算は二人で12万ウォン。',
    mealChoice: 'local_specialty',
  },
  { id: '07', text: '延南洞でローカルらしい夕食を食べたい。', mealChoice: 'local_specialty' },
  { id: '08', text: '麻浦でイタリアンのランチと本屋に行きたい。', mealChoice: 'western' },
  { id: '09', text: '北村で和食ランチの後、写真を撮りながら散歩したい。', mealChoice: 'japanese' },
  { id: '10', text: 'ソウル駅に13時着、ホテルは弘大です。荷物を持っているので先に移動したい。' },
  {
    id: '11',
    text: '梨泰院でビーガン対応のランチと雑貨ショッピングをしたい。',
    mealChoice: 'local_specialty',
  },
  {
    id: '12',
    text: '汝矣島で桜を見ながらピクニックしたい。雨なら室内に変えて。',
    followGeneralChoice: true,
  },
  { id: '13', text: '新村で学生らしい安い夕食、1人2万ウォン以内で。', mealChoice: 'korean' },
  { id: '14', text: '鐘路で中華ランチ、博物館、カフェを17時までに。', mealChoice: 'chinese' },
  { id: '15', text: '弘大で公園を散歩したい。' },
  { id: '16', text: '聖水で歩くのが苦手です。近い場所だけでカフェとショッピングを。' },
  { id: '17', text: '合井で焼肉の夕食、ライブ音楽、その後バーに行きたい。' },
  { id: '18', text: '西村で韓屋カフェと伝統工芸を見たい。', followGeneralChoice: true },
  { id: '19', text: '友達と週末にソウルで遊びたい。', expectQuestion: true },
  {
    id: '20',
    text: '弘大で友達3人、土曜日13〜18時にカフェと夕食を楽しみたい。',
    mealChoice: 'cafe_dessert',
  },
];

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function send(thread: Thread, body: Record<string, unknown>): Promise<ChatResponse> {
  return request(`/chat/threads/${thread.threadId}/messages`, {
    method: 'POST',
    headers: { 'x-thread-secret': thread.threadSecret },
    body: JSON.stringify({ locale: 'ja', requestId: crypto.randomUUID(), ...body }),
  });
}

async function runScenario(scenario: Scenario): Promise<{ id: string; outcome: string }> {
  const locale = scenario.locale ?? 'ja';
  const thread = await request<Thread>('/chat/threads', {
    method: 'POST',
    body: JSON.stringify({ locale }),
  });
  let result = await send(thread, {
    message: scenario.text,
    locale,
    startFreshTrip: true,
    profilePolicy: 'ignore',
  });

  if (scenario.expectQuestion) {
    assert(
      result.pendingQuestion || (result.actionChips?.length ?? 0) > 0,
      `${scenario.id}: required clarification was skipped`,
    );
    assert(!result.resultTripId, `${scenario.id}: incomplete request created a trip`);
    return { id: scenario.id, outcome: 'clarified' };
  }

  const mealQuestion = result.pendingQuestion;
  const mealOption = mealQuestion?.options.find(
    (candidate) =>
      candidate.mealCuisine === scenario.mealChoice ||
      candidate.mealPreference === scenario.mealChoice,
  );
  const mealChip = result.actionChips?.find(
    (chip) =>
      chip.mealCuisine === scenario.mealChoice || chip.mealPreference === scenario.mealChoice,
  );
  if (scenario.mealChoice && mealQuestion) {
    const option = mealOption;
    assert(option, `${scenario.id}: requested meal option was not offered`);
    result = await send(thread, {
      message: option.id,
      questionId: mealQuestion.id,
      optionId: option.id,
      expectedRevision: mealQuestion.revision,
      ...(option.mealCuisine ? { mealCuisine: option.mealCuisine } : {}),
      ...(option.mealPreference === 'local_specialty' ? { mealPreference: 'local_specialty' } : {}),
    });
    assert(!result.pendingQuestion, `${scenario.id}: repeated the answered meal question`);
  } else if (scenario.mealChoice && mealChip) {
    assert(
      mealChip.questionId && mealChip.optionId,
      `${scenario.id}: meal chip lacks structured IDs`,
    );
    result = await send(thread, {
      message: mealChip.query,
      questionId: mealChip.questionId,
      optionId: mealChip.optionId,
      ...(mealChip.mealCuisine ? { mealCuisine: mealChip.mealCuisine } : {}),
      ...(mealChip.mealPreference === 'local_specialty'
        ? { mealPreference: 'local_specialty' }
        : {}),
    });
  }

  if (scenario.followGeneralChoice && !result.resultTripId && result.actionChips?.[0]) {
    result = await send(thread, {
      message: result.actionChips[0].query,
      startFreshTrip: true,
      profilePolicy: 'ignore',
    });
  }

  // Exercise the same guided continuation the UI offers after the first
  // response. A scenario should not be counted as a generation failure merely
  // because the planner asked a legitimate follow-up question.
  for (let attempt = 0; attempt < 3 && !result.resultTripId; attempt += 1) {
    const question = result.pendingQuestion;
    const option = question?.options[0];
    const chip = result.actionChips?.[0];
    if (question && option) {
      result = await send(thread, {
        message: option.id,
        questionId: question.id,
        optionId: option.id,
        expectedRevision: question.revision,
        ...(option.mealCuisine ? { mealCuisine: option.mealCuisine } : {}),
        ...(option.mealPreference ? { mealPreference: option.mealPreference } : {}),
      });
      continue;
    }
    if (chip?.questionId && chip.optionId) {
      result = await send(thread, {
        message: chip.query,
        questionId: chip.questionId,
        optionId: chip.optionId,
        ...(chip.mealCuisine ? { mealCuisine: chip.mealCuisine } : {}),
        ...(chip.mealPreference ? { mealPreference: chip.mealPreference } : {}),
      });
      continue;
    }
    break;
  }

  assert(!result.errorCode, `${scenario.id}: ${result.errorCode}`);
  assert(result.resultTripId, `${scenario.id}: did not create a trip (${result.responseMessage})`);
  assert((result.resultTrip?.stops?.length ?? 0) > 0, `${scenario.id}: trip has no stops`);
  if (scenario.mealChoice === 'cafe_dessert') {
    assert(
      result.resultTrip?.stops?.some(
        (stop) => stop.stopType === 'meal' && stop.category === 'cafe',
      ),
      `${scenario.id}: cafe-dessert meal did not produce a cafe meal stop`,
    );
  }
  return { id: scenario.id, outcome: 'trip-created' };
}

async function main(): Promise<void> {
  const outcomes: Array<{ id: string; outcome: string }> = [];
  const failures: string[] = [];
  for (const scenario of scenarios) {
    try {
      outcomes.push(await runScenario(scenario));
    } catch (error) {
      failures.push(`${scenario.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(JSON.stringify({ baseUrl, outcomes, failures }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

void main();
