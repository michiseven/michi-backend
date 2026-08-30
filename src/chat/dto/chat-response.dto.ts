import type { PendingTripMutation, ReplacementCandidate, VerifiedPlaceFacts } from '../chat-state';
import type { TripDto } from '../../trips/trip-response';

export type ChatRunStatus = 'completed' | 'awaiting_confirmation' | 'rejected' | 'failed';

export interface ActionChipDto {
  label: string;
  query: string;
  type?: string;
}

export interface CreateThreadResponseDto {
  threadId: string;
  threadSecret: string;
}

export interface ChatResponseDto {
  threadId: string;
  threadSecret?: string;
  /**
   * 새 일정을 생성한 응답에서만 반환되는 일회성 편집 capability입니다.
   * LangGraph state/checkpoint에는 저장하지 않습니다.
   */
  editToken?: string;
  status: ChatRunStatus;
  responseMessage: string;
  actionChips?: ActionChipDto[];
  pendingAction?: PendingTripMutation | null;
  alternatives?: ReplacementCandidate[];
  verifiedPlaceFacts?: VerifiedPlaceFacts | null;
  resultTripId?: string | null;
  resultTrip?: TripDto | null;
  errorCode?: string | null;
}
