import { ConfigService } from '@nestjs/config';
import { TtlCache } from '../../common/cache/ttl-cache';
import { NaverPlaceProvider } from './naver-place.provider';
import {
  searchPlaceWithDiagnostics,
  summarizePlaceSearchDiagnostics,
} from './place-search-diagnostics';
import type { PlaceProvider } from './place-provider';

describe('place search diagnostics', () => {
  afterEach(() => jest.restoreAllMocks());

  it('distinguishes fetched records from provider-side filtered records', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              title: '서울 산책로',
              category: '여행>명소>산책로',
              address: '서울특별시 마포구 망원동',
              mapx: '1269000000',
              mapy: '375500000',
            },
            {
              title: '부산 산책로',
              category: '여행>명소>산책로',
              address: '부산광역시 해운대구',
              mapx: '1290000000',
              mapy: '350000000',
            },
          ],
        }),
    } as Response);
    const provider = new NaverPlaceProvider(
      new ConfigService({
        NAVER_LOCAL_SEARCH_URL: 'https://naver.example/local',
        NAVER_CLIENT_ID: 'id',
        NAVER_CLIENT_SECRET: 'secret',
        PROVIDER_CACHE_TTL_SECONDS: 300,
      }),
      new TtlCache(),
    );

    const response = await provider.search({ area: '망원', query: '산책로', limit: 5 });

    expect(response.places).toHaveLength(1);
    expect(response.diagnostics).toEqual({
      fetched: 2,
      unique: 1,
      filteredOut: 1,
      status: 'ok',
    });
  });

  it('keeps provider errors separate from empty and filtered-out roles', async () => {
    const provider: PlaceProvider = {
      name: 'test-provider',
      mode: 'live',
      search: jest.fn().mockRejectedValue(new Error('timeout')),
    };
    const failed = await searchPlaceWithDiagnostics(
      provider,
      { area: '홍대', query: '산책로' },
      'stroll',
    );
    const empty = {
      role: 'cafe',
      query: '카페',
      provider: 'test-provider',
      providerMode: 'live' as const,
      fetched: 0,
      unique: 0,
      insideAllowedArea: 0,
      eligible: 0,
      status: 'empty_response' as const,
      providerError: null,
      records: [],
    };
    const filtered = {
      ...empty,
      role: 'park',
      query: '공원',
      fetched: 3,
      status: 'filtered_out' as const,
    };

    expect(failed.status).toBe('provider_error');
    expect(failed.providerError?.message).toBe('timeout');
    expect(
      summarizePlaceSearchDiagnostics([failed, empty, filtered], ['stroll', 'cafe', 'park']),
    ).toMatchObject({
      missingRoles: ['cafe', 'park'],
      providerFailures: [expect.objectContaining({ role: 'stroll', status: 'provider_error' })],
      roles: [
        expect.objectContaining({ role: 'stroll', status: 'provider_error' }),
        expect.objectContaining({ role: 'cafe', status: 'missing' }),
        expect.objectContaining({ role: 'park', status: 'missing', fetched: 3 }),
      ],
    });
  });

  it('marks a role satisfied with one eligible candidate regardless of an internal result target', async () => {
    const provider: PlaceProvider = {
      name: 'fixture-provider',
      mode: 'mock',
      search: jest.fn().mockResolvedValue({
        provider: 'fixture-provider',
        providerMode: 'mock',
        query: '공원',
        places: [
          {
            provider: 'fixture-provider',
            providerMode: 'mock',
            sourcePlaceId: 'park-1',
            sourcePlaceIdKind: 'provider',
            name: '서울숲',
            rawCategory: '공원',
            address: '서울특별시 성동구',
            roadAddress: null,
            longitude: 127,
            latitude: 37.5,
            rawPayload: {},
          },
        ],
        diagnostics: { fetched: 1, unique: 1, filteredOut: 0, status: 'ok' },
      }),
    };
    const attempt = await searchPlaceWithDiagnostics(
      provider,
      { area: '성수', query: '공원' },
      'stroll',
      (record) => ({
        insideAllowedArea: record.address?.includes('성동구') ?? false,
        eligible: record.rawCategory === '공원',
      }),
    );

    expect(attempt).toMatchObject({
      fetched: 1,
      unique: 1,
      insideAllowedArea: 1,
      eligible: 1,
      status: 'ok',
    });
    expect(summarizePlaceSearchDiagnostics([attempt], ['stroll']).missingRoles).toEqual([]);
  });
});
