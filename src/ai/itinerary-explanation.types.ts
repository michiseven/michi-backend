export type ExplanationMode = 'live' | 'mock' | 'fallback';

export interface TripExplanation {
  tripSummary: string;
  locale: 'ko' | 'ja';
  mode: ExplanationMode;
  model: string | null;
  generatedAt?: string;
}

export interface StopExplanation {
  shortDescription: string;
  previousStopFit: string | null;
  nextStopFit: string | null;
  overallTripFit: string;
}

export interface StopExplanationItem extends StopExplanation {
  order: number;
  placeId: string;
}

export interface ItineraryExplanationInputStop {
  order: number;
  dayNumber: number;
  dayDate?: string | null;
  placeId: string;
  placeName: string;
  category: string | null;
  rawCategory?: string | null;
  address?: string | null;
  district?: string | null;
  stopType: string;
  arrivalAt: string; // HH:mm
  leaveAt: string; // HH:mm
  estimatedStayMinutes: number;
  estimatedCost: number | null;
  reason: string;
  scoreBreakdown: Record<string, number | null | undefined>;
  crowdContext?: {
    areaName: string;
    congestionLevel: string | null;
    scope: 'area';
  } | null;
  inboundRoute?: {
    durationMinutes: number;
    distanceKm: number | null;
    transportMode: string;
    evidence: string;
  } | null;
  nextLegRoute?: {
    durationMinutes: number;
    distanceKm: number | null;
    transportMode: string;
    evidence: string;
  } | null;
  tourismEvidence?: {
    concentration?: {
      level?: string;
      referencePeriod?: string | null;
      areaName?: string | null;
    };
    sourceRef?: string | null;
  } | null;
  verifiedDescription?: string | null;
}

export interface ItineraryExplanationInput {
  locale: 'ko' | 'ja';
  preference: {
    area?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    totalDays?: number | null;
    startTime: string;
    endTime: string;
    budget?: number | null;
    partySize?: number | null;
    companions?: string | null;
    interests: string[];
    preferences: string[];
    avoid: string[];
  };
  stops: ItineraryExplanationInputStop[];
}

export interface ItineraryExplanationResult {
  tripSummary: string;
  locale: 'ko' | 'ja';
  stops: StopExplanationItem[];
  mode: ExplanationMode;
  model: string | null;
  generatedAt?: string;
}

export const ITINERARY_EXPLANATION_PROVIDER = Symbol('ITINERARY_EXPLANATION_PROVIDER');

export interface ItineraryExplanationProvider {
  generate(input: ItineraryExplanationInput): Promise<ItineraryExplanationResult>;
}
