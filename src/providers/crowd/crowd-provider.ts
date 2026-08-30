import type { ProviderMode } from '../../common/config/env.validation';

export const CROWD_PROVIDER = Symbol('CROWD_PROVIDER');

export interface CrowdObservation {
  provider: string;
  providerMode: ProviderMode;
  scope: 'area';
  areaName: string;
  areaCode: string | null;
  congestionLevel: string | null;
  congestionMessage: string | null;
  observedAt: string | null;
  disclaimer: string;
  sourceUrl: string | null;
  rawPayload: Record<string, unknown>;
  requestedAreaName?: string;
  referenceDistanceMeters?: number;
}

export interface CrowdProvider {
  readonly mode: ProviderMode;
  readonly name: string;
  getAreaCrowd(areaName: string): Promise<CrowdObservation | null>;
}
