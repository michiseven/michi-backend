/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/explicit-function-return-type */
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { PlaceDetailEvidence } from '../database/entities';
import { PlaceDetailEnrichmentService } from './place-detail-enrichment.service';
import type { PlaceDetailSearchInput } from './place-detail-evidence.types';
import type { OpenAIPlaceDetailSearchProvider } from './openai-place-detail-search.provider';

describe('PlaceDetailEnrichmentService', () => {
  const input: PlaceDetailSearchInput = {
    placeId: 'place-1',
    name: '대림창고',
    localizedName: '대림창고',
    address: '서울 성동구 성수동2가',
    roadAddress: '서울 성동구 성수이로 78',
    userQuery: '영업시간 알려줘',
    locale: 'ko',
  };

  const entity = {
    id: 'evidence-1',
    placeId: 'place-1',
    provider: 'openai-web-search',
    model: 'gpt-test',
    responseId: 'resp-1',
    status: 'partial',
    evidence: {
      placeMatched: true,
      matchedName: '대림창고',
      matchedAddress: '서울 성동구 성수이로 78',
      businessHours: {
        status: 'sourced',
        value: '11:00~22:00',
        sources: [{ title: 'KTO', url: 'https://example.com/kto' }],
      },
      price: { status: 'unavailable', value: null, sources: [] },
      warnings: [],
    },
    fetchedAt: new Date('2026-08-29T00:00:00.000Z'),
    expiresAt: new Date('2026-08-30T00:00:00.000Z'),
  } as unknown as PlaceDetailEvidence;

  function createService(cached: PlaceDetailEvidence | null) {
    const repo = {
      findOne: jest.fn().mockResolvedValue(cached),
      create: jest.fn((value: any) => ({ ...entity, ...value })),
      save: jest.fn((value: any) => Promise.resolve(value)),
    } as unknown as Repository<PlaceDetailEvidence>;
    const provider = {
      search: jest.fn().mockResolvedValue({
        provider: entity.provider,
        model: entity.model,
        responseId: entity.responseId,
        status: entity.status,
        evidence: entity.evidence,
      }),
    } as unknown as OpenAIPlaceDetailSearchProvider;
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'PLACE_DETAIL_WEB_SEARCH_ENABLED') return true;
        if (key === 'PLACE_DETAIL_WEB_CACHE_TTL_SECONDS') return 86_400;
        return undefined;
      }),
    } as unknown as ConfigService;
    return {
      service: new PlaceDetailEnrichmentService(repo, provider, config),
      repo: repo as any,
      provider: provider as any,
    };
  }

  it('returns a non-expired cached snapshot without another paid search', async () => {
    const { service, provider } = createService(entity);

    const result = await service.enrich(input);

    expect(result?.cacheHit).toBe(true);
    expect(result?.evidence.businessHours.value).toBe('11:00~22:00');
    expect(provider.search).not.toHaveBeenCalled();
  });

  it('persists a new provider result with an expiry timestamp', async () => {
    const { service, provider, repo } = createService(null);

    const result = await service.enrich(input);

    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(result?.cacheHit).toBe(false);
    expect(result?.expiresAt).toBeDefined();
  });
});
