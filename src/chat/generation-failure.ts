import type { TripRelaxation } from '../trips/trip-generation-recovery';

/** A stable boundary between internal generation exceptions and the chat API. */
export interface GenerationFailure {
  code: string;
  message: string;
  chips: Array<{
    label: string;
    query: string;
    type: 'refine';
    requestPatch?: { relaxations: TripRelaxation[] };
  }>;
}

function exceptionCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  if (response && typeof response === 'object' && 'code' in response) {
    return typeof (response as { code?: unknown }).code === 'string'
      ? (response as { code: string }).code
      : null;
  }
  return typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null;
}

export function generationFailure(error: unknown, locale: 'ko' | 'ja'): GenerationFailure {
  const sourceCode = exceptionCode(error);
  const code =
    sourceCode &&
    /^(AREA_REQUIRED|NO_FEASIBLE_ROUTE|MEAL_CUISINE_NOT_FOUND|MANDATORY_PLACE_NOT_FOUND|ROUTE_EVIDENCE_INFEASIBLE|INSUFFICIENT_VERIFIED_COVERAGE|MEAL_EVIDENCE_MISSING|THEME_EVIDENCE_MISSING)$/.test(
      sourceCode,
    )
      ? sourceCode
      : 'GENERATION_UNAVAILABLE';
  const ja: Record<string, GenerationFailure> = {
    AREA_REQUIRED: {
      code,
      message:
        'エリアをまだ決められませんでした。近いエリアを選ぶと、確認できる候補から組み直せます。',
      chips: [
        { label: '弘大で探す', query: '弘大で旅程を作って', type: 'refine' },
        { label: '聖水で探す', query: '聖水で旅程を作って', type: 'refine' },
        { label: '明洞で探す', query: '明洞で旅程を作って', type: 'refine' },
      ],
    },
    MEAL_CUISINE_NOT_FOUND: {
      code,
      message:
        '指定した料理を確認できる食事スポットが見つかりませんでした。料理かエリアの条件を少し緩めてください。',
      chips: [
        {
          label: '近いエリアも許可',
          query: '近いエリアも含めて食事を探して',
          type: 'refine',
          requestPatch: { relaxations: ['search_radius'] },
        },
        {
          label: '料理を変更',
          query: '料理の指定を外して旅程を作って',
          type: 'refine',
          requestPatch: { relaxations: ['meal_cuisine'] },
        },
        {
          label: '時間を広げる',
          query: '食事の時間を30分広げて',
          type: 'refine',
          requestPatch: { relaxations: ['route_constraints'] },
        },
      ],
    },
    ROUTE_EVIDENCE_INFEASIBLE: {
      code,
      message:
        '確認できる移動時間では、指定の時間内に収まりませんでした。時間かエリアを調整してください。',
      chips: [
        {
          label: '30分延ばす',
          query: '終了時刻を30分遅らせて',
          type: 'refine',
          requestPatch: { relaxations: ['route_constraints'] },
        },
        {
          label: '近いエリアに絞る',
          query: '近いエリアだけで旅程を作って',
          type: 'refine',
          requestPatch: { relaxations: ['search_radius'] },
        },
        {
          label: '移動を少なくする',
          query: '移動を少なくして旅程を作って',
          type: 'refine',
          requestPatch: { relaxations: ['route_constraints'] },
        },
      ],
    },
    MANDATORY_PLACE_NOT_FOUND: {
      code,
      message: '必須スポットを確認できませんでした。正式名称か近いエリアを指定してください。',
      chips: [
        { label: '正式名称を入力', query: 'スポットの正式名称を指定して作り直す', type: 'refine' },
        { label: '近いエリアで探す', query: '近いエリアで代替スポットを探して', type: 'refine' },
      ],
    },
    INSUFFICIENT_VERIFIED_COVERAGE: {
      code,
      message:
        '確認できる移動根拠が不足しているため、完成した旅程として表示しません。時間を広げるか、近いエリアに絞ってください。',
      chips: [
        { label: '近いエリアに絞る', query: '近いエリアだけで旅程を作って', type: 'refine' },
        { label: '時間を30分広げる', query: '時間を30分広げて旅程を作って', type: 'refine' },
      ],
    },
    MEAL_EVIDENCE_MISSING: {
      code,
      message:
        '指定した食事の根拠を確認できないため、完成した旅程として表示しません。料理・時間・エリアを調整してください。',
      chips: [
        { label: '料理を変更', query: '料理の指定を外して旅程を作って', type: 'refine' },
        { label: '近いエリアも許可', query: '近いエリアも含めて食事を探して', type: 'refine' },
        { label: '食事時間を広げる', query: '食事の時間を30分広げて', type: 'refine' },
      ],
    },
    THEME_EVIDENCE_MISSING: {
      code,
      message:
        '指定したテーマに合うスポット根拠を確認できないため、完成した旅程として表示しません。テーマかエリアを調整してください。',
      chips: [
        { label: '近いエリアも許可', query: '近いエリアも含めて旅程を作って', type: 'refine' },
        { label: 'テーマを変更', query: 'テーマの指定を外して旅程を作って', type: 'refine' },
        { label: '時間を30分広げる', query: '時間を30分広げて旅程を作って', type: 'refine' },
      ],
    },
    NO_FEASIBLE_ROUTE: {
      code,
      message: '指定条件を同時に満たす、確認可能なルートが見つかりませんでした。',
      chips: [
        { label: '近いエリアも許可', query: '近いエリアも含めて旅程を作って', type: 'refine' },
        { label: '時間を30分広げる', query: '時間を30分広げて旅程を作って', type: 'refine' },
        { label: '条件を一つ緩める', query: '優先条件を一つ緩めて旅程を作って', type: 'refine' },
      ],
    },
    GENERATION_UNAVAILABLE: {
      code,
      message:
        'いまは確認可能な旅程を作成できませんでした。エリア・時間・食事のいずれかを調整してください。',
      chips: [
        { label: 'エリアを選ぶ', query: '弘大で旅程を作って', type: 'refine' },
        { label: '時間を広げる', query: '時間を30分広げて旅程を作って', type: 'refine' },
      ],
    },
  };
  const selected = ja[code] ?? ja.GENERATION_UNAVAILABLE!;
  if (locale === 'ja') return selected;
  return {
    ...selected,
    message: '확인 가능한 일정이 없어 생성하지 않았습니다. 지역·시간·식사 조건을 조정해 주세요.',
  };
}
