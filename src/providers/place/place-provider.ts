import type { ProviderMode } from '../../common/config/env.validation';

export const PLACE_PROVIDER = Symbol('PLACE_PROVIDER');
export const ITINERARY_PLACE_PROVIDER = Symbol('ITINERARY_PLACE_PROVIDER');

export interface PlaceSearchRequest {
  query: string;
  area: string;
  limit?: number;
  role?: string;
}

export interface ProviderPlaceRecord {
  provider: string;
  providerMode: ProviderMode;
  sourcePlaceId: string;
  sourcePlaceIdKind: 'provider' | 'derived';
  name: string;
  rawCategory: string | null;
  address: string | null;
  roadAddress: string | null;
  longitude: number | null;
  latitude: number | null;
  rawPayload: Record<string, unknown>;
}

export type PlaceSearchResponseStatus = 'ok' | 'empty_response' | 'filtered_out';

/** Provider-level counts before area/category eligibility is applied. */
export interface PlaceSearchResponseDiagnostics {
  fetched: number;
  unique: number;
  filteredOut: number;
  status: PlaceSearchResponseStatus;
}

export interface PlaceSearchResponse {
  provider: string;
  providerMode: ProviderMode;
  query: string;
  places: ProviderPlaceRecord[];
  diagnostics?: PlaceSearchResponseDiagnostics;
}

export interface PlaceProvider {
  readonly mode: ProviderMode;
  readonly name: string;
  search(request: PlaceSearchRequest): Promise<PlaceSearchResponse>;
}
