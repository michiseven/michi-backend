import type { AccessibilityLegEvidence } from '../routing/accessibility-evidence';

/** A user request and an LLM extraction are never evidence about a venue. */
export const SAFETY_CONSTRAINT_KINDS = [
  'food_allergy',
  'medical',
  'wheelchair',
  'stroller',
  'stairs_avoidance',
] as const;

export type SafetyConstraintKind = (typeof SAFETY_CONSTRAINT_KINDS)[number];
export type SafetyScope = 'place' | 'route' | 'facility';
export type SafetyAssessmentStatus = 'verified' | 'unverified' | 'unsupported';
export type SafetyAssessmentResult = 'satisfied' | 'unsatisfied' | 'unknown';

export interface SafetyRequest {
  id: string;
  kind: SafetyConstraintKind;
  scope: SafetyScope;
}

export interface SafetySourceRef {
  title: string;
  url: string | null;
  fetchedAt: string | null;
}

export interface SafetyAssessment {
  id: string;
  kind: SafetyConstraintKind;
  scope: SafetyScope;
  status: SafetyAssessmentStatus;
  result: SafetyAssessmentResult;
  sourceRefs: SafetySourceRef[];
  warnings: string[];
}

export interface TripSafetyConstraintsDto {
  requested: SafetyRequest[];
  assessments: SafetyAssessment[];
  requiresUserConfirmation: boolean;
}

const TEXT_PATTERNS: ReadonlyArray<[SafetyConstraintKind, RegExp]> = [
  [
    'food_allergy',
    /알레르기|알러지|갑각류|견과|땅콩|우유|계란|gluten|allerg(?:y|ic)|shellfish|peanut|乳|卵|甲殻|アレルギー/iu,
  ],
  ['medical', /의료|약 복용|복용 중|질환|응급|medical|medication|health|病気|服薬|持病|医療/iu],
  ['wheelchair', /휠체어|wheelchair|車椅子/iu],
  ['stroller', /유모차|아기차|stroller|baby carriage|ベビーカー/iu],
  [
    'stairs_avoidance',
    /계단.*(?:피|없|제외)|계단 회피|stairs?(?:\s+avoid|\s+free)?|階段.*(?:避|なし)|階段回避/iu,
  ],
];

function defaultScope(kind: SafetyConstraintKind): SafetyScope {
  return kind === 'food_allergy' || kind === 'medical' ? 'place' : 'route';
}

export function resolveSafetyRequests(
  text: string,
  explicit?: readonly SafetyConstraintKind[],
): SafetyRequest[] {
  const detected = TEXT_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
  return [...new Set([...(explicit ?? []), ...detected])].map((kind) => ({
    id: `safety-${kind}`,
    kind,
    scope: defaultScope(kind),
  }));
}

function unverifiedAssessment(request: SafetyRequest): SafetyAssessment {
  return {
    id: request.id,
    kind: request.kind,
    scope: request.scope,
    status: 'unverified',
    result: 'unknown',
    sourceRefs: [],
    warnings: [
      '확인 가능한 장소별 안전 데이터가 없어 미확인입니다. 요청 자체나 AI 응답을 장소 사실로 처리하지 않습니다.',
    ],
  };
}

export function tripSafetyConstraints(
  requested: readonly SafetyRequest[],
): TripSafetyConstraintsDto {
  return {
    requested: [...requested],
    assessments: requested.map(unverifiedAssessment),
    requiresUserConfirmation: requested.length > 0,
  };
}

export function stopAccessibilitySafety(
  requested: readonly SafetyRequest[],
  evidence: AccessibilityLegEvidence | null | undefined,
): SafetyAssessment[] | undefined {
  if (requested.length === 0) return undefined;
  return requested.map((request) => {
    const assessment = unverifiedAssessment(request);
    if (
      evidence?.status !== 'checked' ||
      !['wheelchair', 'stroller', 'stairs_avoidance'].includes(request.kind)
    ) {
      return assessment;
    }
    return {
      ...assessment,
      scope: 'route',
      sourceRefs: evidence.sourceRefs.map((url) => ({
        title: '서울시 공개 GIS 보행 위험 탐지 데이터',
        url: safeHttpsUrl(url),
        fetchedAt: null,
      })),
      warnings: [
        evidence.risk === 'none-detected'
          ? '직선 회랑에서 계단·급경사 위험이 탐지되지 않았습니다. 실제 보행 경로·장소 출입 가능은 검증하지 않았습니다.'
          : '직선 회랑에서 보행 위험 신호가 탐지됐습니다. 실제 보행 경로·장소 출입 가능 여부는 검증하지 않았습니다.',
      ],
    };
  });
}

function safeHttpsUrl(value: string): string | null {
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export function safetyWarnings(safety: TripSafetyConstraintsDto): string[] {
  if (safety.requested.length === 0) return [];
  return [
    '안전 제약은 확인된 장소별 근거가 없어 미확인 상태입니다. 추천 결과를 안전 또는 이용 가능으로 확정하지 말고, 예약·방문 전 공식 장소 정보와 직접 확인해 주세요.',
    '확인된 장소별 근거가 연결되기 전까지 안전 제약은 자동 후보 제외 필터에 적용하지 않습니다.',
  ];
}
