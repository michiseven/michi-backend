import type {
  TripGenerationFailureDiagnostics,
  TripGenerationFailureStage,
  TripGenerationRecovery,
  TripRelaxation,
} from '../trips/trip-generation-recovery';
import type { PublicationValidation } from '../trips/completed-itinerary-eligibility';

type Locale = 'ko' | 'ja';

/** A stable, localized boundary between internal generation exceptions and the chat API. */
export interface GenerationFailure {
  code: string;
  message: string;
  stage?: TripGenerationFailureStage;
  affectedRequirement?: string;
  diagnostics?: TripGenerationFailureDiagnostics;
  validation?: PublicationValidation;
  chips: Array<{
    label: string;
    query: string;
    type: 'refine';
    requestPatch?: { relaxations: TripRelaxation[] };
    /** The client must let the user edit/confirm this request before resubmitting it. */
    requiresUserEdit?: boolean;
  }>;
}

type FailureChip = GenerationFailure['chips'][number];

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

function exceptionRecovery(error: unknown): TripGenerationRecovery | null {
  if (!error || typeof error !== 'object') return null;
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  if (!response || typeof response !== 'object') return null;
  const recovery = (response as { recovery?: unknown }).recovery;
  if (!recovery || typeof recovery !== 'object') return null;
  return recovery as TripGenerationRecovery;
}

function exceptionValidation(error: unknown): PublicationValidation | null {
  if (!error || typeof error !== 'object') return null;
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  if (!response || typeof response !== 'object') return null;
  const validation = (response as { validation?: unknown }).validation;
  return validation && typeof validation === 'object'
    ? (validation as PublicationValidation)
    : null;
}

const KNOWN_CODES = new Set([
  'AREA_REQUIRED',
  'AREA_FILTER_UNAVAILABLE',
  'AREA_CONSTRAINTS_VIOLATED',
  'PLACE_PROVIDER_UNAVAILABLE',
  'NO_FEASIBLE_ROUTE',
  'MEAL_CUISINE_NOT_FOUND',
  'MANDATORY_PLACE_NOT_FOUND',
  'ROUTE_EVIDENCE_INFEASIBLE',
  'ROUTE_CONSTRAINTS_VIOLATED',
  'CATEGORY_CANDIDATES_NOT_FOUND',
  'NO_UNIQUE_PLACE_CANDIDATES',
  'PLACE_CATEGORY_ROLE_MISMATCH',
  'DUPLICATE_PLACE_ACROSS_DAYS',
  'INSUFFICIENT_VERIFIED_COVERAGE',
  'MEAL_EVIDENCE_MISSING',
  'THEME_EVIDENCE_MISSING',
]);

const retry = (label: string, query: string, relaxation: TripRelaxation): FailureChip => ({
  label,
  query,
  type: 'refine' as const,
  requestPatch: { relaxations: [relaxation] },
});

const edit = (label: string, query: string): FailureChip => ({
  label,
  query,
  type: 'refine' as const,
  requiresUserEdit: true,
});

function copy(
  locale: Locale,
  code: string,
  recovery: TripGenerationRecovery | null,
): Omit<GenerationFailure, 'code'> {
  const ko = locale === 'ko';
  const text = (korean: string, japanese: string): string => (ko ? korean : japanese);
  const nearby = (): FailureChip =>
    retry(
      text('인근 지역까지 포함', '近いエリアも許可'),
      text('인근 지역까지 포함해 다시 일정 짜줘', '近いエリアも含めて旅程を作って'),
      'search_radius',
    );
  const route = (): FailureChip =>
    retry(
      text('이동 제약 완화', '移動を少なくする'),
      text('이동 제약을 완화해 다시 일정 짜줘', '移動を少なくして旅程を作って'),
      'route_constraints',
    );
  const cuisine = (): FailureChip =>
    retry(
      text('음식 종류 조건 해제', '料理を変更'),
      text('음식 종류 조건 없이 다시 일정 짜줘', '料理の指定を外して旅程を作って'),
      'meal_cuisine',
    );
  const changeTheme = (): FailureChip =>
    edit(
      text('테마를 수정하기', 'テーマを修正'),
      text('테마를 바꿔서 다시 일정 짜줘', 'テーマを変えて旅程を作って'),
    );
  const specify = (): FailureChip =>
    edit(
      text('조건을 직접 수정하기', '条件を直接修正'),
      text('조건을 수정해서 다시 일정 짜줘', '条件を修正して旅程を作って'),
    );

  const area = (): FailureChip =>
    edit(
      text('지역을 직접 수정하기', 'エリアを修正する'),
      text('지역을 직접 확인해서 다시 일정 짜줘', 'エリアを確認して旅程を作って'),
    );
  const retryProvider = (): FailureChip => ({
    label: text('같은 조건으로 다시 시도', '同じ条件で再試行'),
    query: text('같은 조건으로 다시 찾아줘', '同じ条件で再検索して'),
    type: 'refine' as const,
  });

  switch (code) {
    case 'AREA_REQUIRED':
      return {
        message: text(
          '일정을 만들 지역을 확인하지 못했습니다. 지역을 지정해 주세요.',
          '旅程を作るエリアを確認できませんでした。エリアを指定してください。',
        ),
        chips: [
          edit(text('홍대 지정', '弘大を指定'), text('홍대에서 일정 짜줘', '弘大で旅程を作って')),
          edit(text('성수 지정', '聖水を指定'), text('성수에서 일정 짜줘', '聖水で旅程を作って')),
        ],
      };
    case 'AREA_FILTER_UNAVAILABLE':
    case 'AREA_CONSTRAINTS_VIOLATED':
      return {
        message: text(
          '요청한 지역의 경계를 확인할 수 없어 서울 전체 장소로 대신하지 않았습니다. 지역을 확인해 주세요.',
          '指定エリアの境界を確認できないため、ソウル全体のスポットで代用しませんでした。エリアを確認してください。',
        ),
        chips: [area()],
      };
    case 'PLACE_PROVIDER_UNAVAILABLE':
      return {
        message: text(
          '외부 장소 검색에 일시적인 문제가 있어 일정을 완성하지 않았습니다. 같은 조건으로 다시 시도해 주세요.',
          '外部スポット検索に一時的な問題があるため、旅程を完成として表示しませんでした。同じ条件で再試行してください。',
        ),
        chips: [retryProvider()],
      };
    case 'MEAL_CUISINE_NOT_FOUND':
      return {
        message: text(
          '지정한 음식 종류의 검증 가능한 식사 장소가 없습니다. 음식 종류나 지역을 조정해 주세요.',
          '指定した料理の確認可能な食事スポットがありません。料理かエリアを調整してください。',
        ),
        chips: recovery?.stage === 'role' ? [cuisine(), nearby()] : [cuisine(), nearby(), route()],
      };
    case 'THEME_EVIDENCE_MISSING':
      return {
        message: text(
          '요청한 테마를 뒷받침할 검증 장소가 없어 일정을 완성하지 않았습니다. 테마를 수정해 주세요.',
          '指定したテーマを裏付ける確認済みスポットがないため、旅程を完成として表示しません。テーマを修正してください。',
        ),
        // A theme is an explicit user promise: never silently remove it or claim it was relaxed.
        chips: [changeTheme()],
      };
    case 'MEAL_EVIDENCE_MISSING':
      return {
        message: text(
          '요청한 식사를 뒷받침할 검증 장소가 없어 일정을 완성하지 않았습니다. 음식 종류나 지역을 조정해 주세요.',
          '指定した食事を裏付ける確認済みスポットがないため、旅程を完成として表示しません。料理かエリアを調整してください。',
        ),
        chips: [cuisine(), nearby(), route()],
      };
    case 'INSUFFICIENT_VERIFIED_COVERAGE':
      return {
        message: text(
          '검증된 체류·이동 시간이 요청 시간대를 충분히 덮지 못해 일정을 완성하지 않았습니다.',
          '確認済みの滞在・移動時間が希望時間帯を十分に満たさないため、旅程を完成として表示しません。',
        ),
        chips: [nearby(), route()],
      };
    case 'ROUTE_EVIDENCE_INFEASIBLE':
    case 'ROUTE_CONSTRAINTS_VIOLATED':
      return {
        message: text(
          '검증 가능한 이동 시간으로는 지정한 조건을 함께 만족할 수 없습니다. 이동 조건을 조정해 주세요.',
          '確認可能な移動時間では指定条件を同時に満たせません。移動条件を調整してください。',
        ),
        chips: [route(), nearby()],
      };
    case 'CATEGORY_CANDIDATES_NOT_FOUND':
    case 'NO_UNIQUE_PLACE_CANDIDATES':
    case 'PLACE_CATEGORY_ROLE_MISMATCH':
    case 'DUPLICATE_PLACE_ACROSS_DAYS':
      return {
        message: text(
          '요청한 역할에 맞는 서로 다른 검증 장소를 충분히 찾지 못했습니다. 지역이나 장소 조건을 수정해 주세요.',
          '指定した役割に合う異なる確認済みスポットを十分に見つけられませんでした。エリアか場所条件を修正してください。',
        ),
        chips: [nearby(), specify()],
      };
    case 'MANDATORY_PLACE_NOT_FOUND':
      return {
        message: text(
          '필수 장소를 확인하지 못했습니다. 정확한 장소명이나 대체 조건을 직접 수정해 주세요.',
          '必須スポットを確認できませんでした。正確な名称か代替条件を直接修正してください。',
        ),
        chips: [specify()],
      };
    case 'NO_FEASIBLE_ROUTE':
      if (recovery?.stage === 'area') {
        return {
          message: text(
            '요청한 지역의 경계를 확인할 수 없어 서울 전체 장소로 대신하지 않았습니다. 지역을 확인해 주세요.',
            '指定エリアの境界を確認できないため、ソウル全体のスポットで代用しませんでした。エリアを確認してください。',
          ),
          chips: [area()],
        };
      }
      if (recovery?.stage === 'candidate' || recovery?.stage === 'role') {
        return {
          message: text(
            '요청한 역할에 맞는 검증 장소를 확보하지 못했습니다. 후보를 더 찾거나 조건을 직접 수정해 주세요.',
            '指定した役割に合う確認済みスポットを確保できませんでした。候補を増やすか条件を修正してください。',
          ),
          chips: [nearby(), specify()],
        };
      }
      return {
        message: text(
          '지정한 조건을 함께 만족하는 검증 가능한 경로가 없습니다. 지역이나 이동 조건을 조정해 주세요.',
          '指定条件を同時に満たす確認可能なルートがありません。エリアか移動条件を調整してください。',
        ),
        chips: [nearby(), route(), specify()],
      };
    default:
      return {
        message: text(
          '지금은 검증 가능한 일정을 만들지 못했습니다. 지역·시간·식사 조건을 수정해 주세요.',
          '現在は確認可能な旅程を作成できませんでした。エリア・時間・食事条件を修正してください。',
        ),
        chips: [specify()],
      };
  }
}

export function generationFailure(error: unknown, locale: Locale): GenerationFailure {
  const sourceCode = exceptionCode(error);
  const code = sourceCode && KNOWN_CODES.has(sourceCode) ? sourceCode : 'GENERATION_UNAVAILABLE';
  const recovery = exceptionRecovery(error);
  const validation = exceptionValidation(error);
  return {
    code,
    ...(recovery?.stage ? { stage: recovery.stage } : {}),
    ...(recovery?.affectedRequirement ? { affectedRequirement: recovery.affectedRequirement } : {}),
    ...(recovery?.diagnostics ? { diagnostics: recovery.diagnostics } : {}),
    ...(validation ? { validation } : {}),
    ...copy(locale, code, recovery),
  };
}
