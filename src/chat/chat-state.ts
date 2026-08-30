import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import type { TripDto } from '../trips/trip-response';
import type { PlaceDetailEvidenceView } from '../place-details/place-detail-evidence.types';

export interface VerifiedPlaceFacts {
  placeId: string;
  name: string;
  sourceName: string;
  category: string | null;
  address: string | null;
  roadAddress: string | null;
  overview: string | null;
  businessHours: string | null;
  priceEvidence: {
    minPrice: number | null;
    maxPrice: number | null;
    sourceTitle?: string | null;
    sourceUrl?: string | null;
  } | null;
  crowdContext: {
    level: string | null;
    areaName: string | null;
    disclaimer: string | null;
  } | null;
  placeDetailLink: {
    provider: 'kakao-map';
    url: string;
  } | null;
  source: string;
  sourcePlaceId: string | null;
  webEvidence: PlaceDetailEvidenceView | null;
}

export interface ReplacementCandidate {
  placeId: string;
  name: string;
  category: string;
  distanceMeters?: number;
  reason: string;
  evidenceStatus: string;
  estimatedCost: number | null;
  priceEvidence?: {
    minPrice: number | null;
    maxPrice: number | null;
    sourceTitle?: string | null;
    sourceUrl?: string | null;
  } | null;
  address?: string | null;
}

export interface PendingTripMutation {
  type: 'trip_mutation_confirmation';
  action: 'remove' | 'replace';
  tripId: string;
  targetStop: {
    stopId: string;
    placeId: string;
    placeName: string;
  };
  alternatives: ReplacementCandidate[];
  warnings: string[];
}

export interface ResumePayload {
  decision: 'approve' | 'reject';
  chosenPlaceId?: string;
}

export const ChatAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (curr, update) => curr.concat(update),
    default: () => [],
  }),
  locale: Annotation<'ko' | 'ja'>({
    reducer: (_, update) => update,
    default: () => 'ja',
  }),
  intent: Annotation<'qa' | 'clarify' | 'create_trip' | 'modify_trip' | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
  currentTripId: Annotation<string | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
  modification: Annotation<{
    action: 'remove' | 'replace';
    targetStopId: string | null;
    targetStopOrder?: number;
    targetPlaceName?: string;
    replacementQuery: string | null;
    chosenPlaceId?: string;
  } | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
  createTripInput: Annotation<{
    text: string;
    startArea?: string;
    travelDate?: string;
    startDate?: string;
    endDate?: string;
    startTime?: string;
    endTime?: string;
    budget?: number;
    airport?: string;
    hotel?: string;
  } | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
  // 상단 여행 폼의 값은 현재 턴에만 사용한다. ChatService가 다음 요청 때 null로
  // 초기화하여 이전 여행 기간이 checkpoint에서 재사용되지 않게 한다.
  formTripContext: Annotation<{
    arrivalDate?: string;
    arrivalTime?: string;
    departureDate?: string;
    departureTime?: string;
    hotel?: string;
  } | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
  verifiedPlaceFacts: Annotation<VerifiedPlaceFacts | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
  alternatives: Annotation<ReplacementCandidate[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),
  pendingAction: Annotation<PendingTripMutation | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
  responseMessage: Annotation<string | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
  actionChips: Annotation<Array<{ label: string; query: string; type?: string }>>({
    reducer: (_, update) => update,
    default: () => [],
  }),
  resultTripId: Annotation<string | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
  resultTrip: Annotation<TripDto | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
  status: Annotation<'completed' | 'awaiting_confirmation' | 'rejected' | 'failed'>({
    reducer: (_, update) => update,
    default: () => 'completed',
  }),
  errorCode: Annotation<string | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
});

export type ChatState = typeof ChatAnnotation.State;
export type ChatUpdate = typeof ChatAnnotation.Update;
