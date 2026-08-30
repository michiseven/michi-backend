import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TtlCache } from '../../common/cache/ttl-cache';
import type {
  PlaceProvider,
  PlaceSearchRequest,
  PlaceSearchResponse,
  ProviderPlaceRecord,
} from './place-provider';

export interface KakaoLocalDocument {
  id?: unknown;
  place_name?: unknown;
  category_name?: unknown;
  phone?: unknown;
  address_name?: unknown;
  road_address_name?: unknown;
  x?: unknown;
  y?: unknown;
  place_url?: unknown;
  category_group_code?: unknown;
  category_group_name?: unknown;
  distance?: unknown;
}

interface KakaoLocalResponse {
  documents?: KakaoLocalDocument[];
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function coordinate(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function normalizeKakaoLocalDocument(
  document: KakaoLocalDocument,
): ProviderPlaceRecord | null {
  const sourcePlaceId = optionalString(document.id);
  const name = optionalString(document.place_name);
  const address = optionalString(document.address_name);
  const roadAddress = optionalString(document.road_address_name);
  if (
    !sourcePlaceId ||
    !name ||
    ![address, roadAddress].some((value) => value?.startsWith('서울'))
  ) {
    return null;
  }

  return {
    provider: 'kakao-local',
    providerMode: 'live',
    sourcePlaceId,
    sourcePlaceIdKind: 'provider',
    name,
    rawCategory: optionalString(document.category_name),
    address,
    roadAddress,
    longitude: coordinate(document.x, -180, 180),
    latitude: coordinate(document.y, -90, 90),
    rawPayload: { ...document },
  };
}

@Injectable()
export class KakaoPlaceProvider implements PlaceProvider {
  readonly mode = 'live' as const;
  readonly name = 'kakao-local';

  constructor(
    private readonly config: ConfigService,
    private readonly cache: TtlCache,
  ) {}

  async search(request: PlaceSearchRequest): Promise<PlaceSearchResponse> {
    const query = request.area ? `${request.area} ${request.query}`.trim() : request.query.trim();
    const limit = Math.min(Math.max(request.limit ?? 15, 1), 15);
    const cacheKey = `place:kakao:${query}:${limit}`;
    const cached = this.cache.get<PlaceSearchResponse>(cacheKey);
    if (cached) return cached;

    const url = new URL(this.config.getOrThrow<string>('KAKAO_LOCAL_SEARCH_URL'));
    url.searchParams.set('query', query);
    url.searchParams.set('size', String(limit));
    url.searchParams.set('page', '1');
    url.searchParams.set('sort', 'accuracy');

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `KakaoAK ${this.config.getOrThrow<string>('KAKAO_REST_API_KEY')}`,
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new BadGatewayException({
        code: 'PLACE_PROVIDER_UNAVAILABLE',
        message: 'Kakao Local Search request failed',
        details: error instanceof Error ? error.message : 'network error',
      });
    }

    if (!response.ok) {
      throw new BadGatewayException({
        code: 'PLACE_PROVIDER_ERROR',
        message: 'Kakao Local Search returned an error',
        details: { status: response.status },
      });
    }

    const payload = (await response.json()) as KakaoLocalResponse;
    if (!Array.isArray(payload.documents)) {
      throw new BadGatewayException({
        code: 'PLACE_PROVIDER_INVALID_RESPONSE',
        message: 'Kakao Local Search response did not contain a documents array',
      });
    }

    const result: PlaceSearchResponse = {
      provider: this.name,
      providerMode: this.mode,
      query,
      places: payload.documents
        .map((document) => normalizeKakaoLocalDocument(document))
        .filter((place): place is ProviderPlaceRecord => place !== null),
    };
    this.cache.set(cacheKey, result, this.config.getOrThrow<number>('PROVIDER_CACHE_TTL_SECONDS'));
    return result;
  }
}
