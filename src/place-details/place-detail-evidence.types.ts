export type PlaceDetailFactStatus = 'sourced' | 'conflicting' | 'unavailable';
export type PlaceDetailEvidenceStatus = 'sourced' | 'partial' | 'conflicting' | 'unavailable';

export interface PlaceDetailSource {
  title: string;
  url: string;
}

export interface PlaceDetailFact {
  status: PlaceDetailFactStatus;
  value: string | null;
  sources: PlaceDetailSource[];
}

export interface PlaceDetailEvidencePayload {
  placeMatched: boolean;
  matchedName: string | null;
  matchedAddress: string | null;
  businessHours: PlaceDetailFact;
  price: PlaceDetailFact;
  warnings: string[];
}

export interface PlaceDetailSearchInput {
  placeId: string;
  name: string;
  localizedName: string;
  address: string | null;
  roadAddress: string | null;
  userQuery: string;
  locale: 'ko' | 'ja';
}

export interface PlaceDetailSearchResult {
  provider: 'openai-web-search';
  model: string;
  responseId: string;
  status: PlaceDetailEvidenceStatus;
  evidence: PlaceDetailEvidencePayload;
}

export interface PlaceDetailSearchProvider {
  search(input: PlaceDetailSearchInput): Promise<PlaceDetailSearchResult | null>;
}

export interface PlaceDetailEnrichmentGateway {
  enrich(input: PlaceDetailSearchInput): Promise<PlaceDetailEvidenceView | null>;
}

export interface PlaceDetailEvidenceView {
  provider: 'openai-web-search';
  model: string;
  status: PlaceDetailEvidenceStatus;
  evidence: PlaceDetailEvidencePayload;
  fetchedAt: string;
  expiresAt: string;
  cacheHit: boolean;
}
