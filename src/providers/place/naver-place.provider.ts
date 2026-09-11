import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TtlCache } from '../../common/cache/ttl-cache';
import { normalizeNaverLocalItem, type NaverLocalItem } from './place-normalizer';
import type { PlaceProvider, PlaceSearchRequest, PlaceSearchResponse } from './place-provider';

interface NaverLocalResponse {
  items?: NaverLocalItem[];
}

@Injectable()
export class NaverPlaceProvider implements PlaceProvider {
  readonly mode = 'live' as const;
  readonly name = 'naver-local';

  constructor(
    private readonly config: ConfigService,
    private readonly cache: TtlCache,
  ) {}

  async search(request: PlaceSearchRequest): Promise<PlaceSearchResponse> {
    const query = request.area ? `${request.area} ${request.query}`.trim() : request.query.trim();
    const limit = Math.min(Math.max(request.limit ?? 5, 1), 5);
    const cacheKey = `place:naver:${query}:${limit}`;
    const cached = this.cache.get<PlaceSearchResponse>(cacheKey);
    if (cached) return cached;

    const url = new URL(this.config.getOrThrow<string>('NAVER_LOCAL_SEARCH_URL'));
    url.searchParams.set('query', query);
    url.searchParams.set('display', String(limit));
    url.searchParams.set('start', '1');
    url.searchParams.set('sort', 'comment');

    let response: Response;
    const ncp = url.hostname === 'naverapihub.apigw.ntruss.com';
    try {
      response = await fetch(url, {
        headers: {
          [ncp ? 'X-NCP-APIGW-API-KEY-ID' : 'X-Naver-Client-Id']:
            this.config.getOrThrow<string>('NAVER_CLIENT_ID'),
          [ncp ? 'X-NCP-APIGW-API-KEY' : 'X-Naver-Client-Secret']:
            this.config.getOrThrow<string>('NAVER_CLIENT_SECRET'),
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new BadGatewayException({
        code: 'PLACE_PROVIDER_UNAVAILABLE',
        message: 'NAVER Local Search request failed',
        details: error instanceof Error ? error.message : 'network error',
      });
    }

    if (!response.ok) {
      throw new BadGatewayException({
        code: 'PLACE_PROVIDER_ERROR',
        message: 'NAVER Local Search returned an error',
        details: { status: response.status },
      });
    }

    const payload = (await response.json()) as NaverLocalResponse;
    if (!Array.isArray(payload.items)) {
      throw new BadGatewayException({
        code: 'PLACE_PROVIDER_INVALID_RESPONSE',
        message: 'NAVER Local Search response did not contain an items array',
      });
    }

    const places = payload.items
      .map((item) => normalizeNaverLocalItem(item))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const unique = new Set(places.map((place) => place.sourcePlaceId)).size;
    const result: PlaceSearchResponse = {
      provider: this.name,
      providerMode: this.mode,
      query,
      places,
      diagnostics: {
        fetched: payload.items.length,
        unique,
        filteredOut: Math.max(payload.items.length - unique, 0),
        status:
          payload.items.length === 0
            ? 'empty_response'
            : places.length === 0
              ? 'filtered_out'
              : 'ok',
      },
    };
    this.cache.set(cacheKey, result, this.config.getOrThrow<number>('PROVIDER_CACHE_TTL_SECONDS'));
    return result;
  }
}
