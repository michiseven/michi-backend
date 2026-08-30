import type { GeoPoint } from '../database/entities';

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');

export type RequestedTransportMode = 'walk' | 'subway' | 'bus' | 'taxi' | null;

export type RouteLegMethod =
  | 'straight-line-walking-estimate'
  | 'naver-directions-driving'
  | 'seoul-subway-path-v1'
  | 'seoul-subway-estimate-v1'
  | 'seoul-bus-estimate-v1';

export type RouteLegEvidence = 'estimated' | 'measured' | 'mixed' | 'unavailable';

export type RouteTransportMode = 'walk' | 'car' | 'subway' | 'bus';

export interface SubwayLegDetails {
  departureStation: string;
  departureStationLine?: string;
  arrivalStation: string;
  arrivalStationLine?: string;
  subwayDurationMinutes: number;
  subwayDistanceKm: number | null;
  fareKrw: number | null;
  transferCount: number;
  pathSummary?: string;
  accessWalkMinutes: number;
  accessWalkDistanceKm: number;
  egressWalkMinutes: number;
  egressWalkDistanceKm: number;
  segments?: Array<{
    departureStation: string;
    arrivalStation: string;
    line: string | null;
    durationMinutes: number;
    distanceKm: number;
    transfer: boolean;
  }>;
}

export interface BusLegDetails {
  nearbyOriginStops?: Array<{ stationId: string; stationName: string; distanceMeters: number }>;
  nearbyDestinationStops?: Array<{
    stationId: string;
    stationName: string;
    distanceMeters: number;
  }>;
  note?: string;
}

export interface RouteLegEstimate {
  distanceKm: number | null;
  durationMinutes: number;
  method: RouteLegMethod;
  evidence: RouteLegEvidence;
  transportMode: RouteTransportMode;
  requestedTransportMode?: RequestedTransportMode;
  measuredAt?: string;
  path?: GeoPoint['coordinates'][];
  subwayDetails?: SubwayLegDetails | null;
  busDetails?: BusLegDetails | null;
  disclaimer: string;
}

export interface MeasureLegOptions {
  travelDate?: string; // YYYY-MM-DD
  departureTime?: string; // HH:mm
  maxWalkMinutes?: number | null;
  allowShortWalkSubstitution?: boolean;
}

export interface RoutingProvider {
  readonly name: string;
  readonly mode: 'mock' | 'live';
  planningEstimate(origin: GeoPoint | null, destination: GeoPoint | null): RouteLegEstimate;
  measureLeg(
    origin: GeoPoint | null,
    destination: GeoPoint | null,
    requestedMode: RequestedTransportMode,
    options?: MeasureLegOptions,
  ): Promise<RouteLegEstimate>;
}
