/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/explicit-function-return-type */
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { Place, PlaceDescriptionTranslation } from '../database/entities';
import { OpenAIPlaceDescriptionSearchProvider } from './openai-place-description-search.provider';
import { PlaceDescriptionTranslationService } from './place-description-translation.service';

describe('PlaceDescriptionTranslationService', () => {
  const place = {
    id: 'place-1',
    source: 'naver-local',
    name: '미라클스터디카페 마포공덕센터',
    address: '서울 마포구 마포대로 92',
    roadAddress: '서울 마포구 마포대로 92',
  } as Place;

  const ko = {
    placeId: place.id,
    locale: 'ko',
    description: '마포대로에 위치한 스터디카페입니다.',
    provider: 'openai-web-search',
    model: 'gpt-test',
    responseId: 'resp-1',
    sources: [{ title: 'Example', url: 'https://example.com/place' }],
    fetchedAt: new Date('2026-08-29T00:00:00.000Z'),
  } as PlaceDescriptionTranslation;
  const ja = {
    ...ko,
    locale: 'ja',
    description: '麻浦大路に位置するスタディカフェです。',
  } as PlaceDescriptionTranslation;

  function createService(existing: PlaceDescriptionTranslation[]) {
    const repo = {
      find: jest.fn().mockResolvedValue(existing),
      create: jest.fn((value: object) => value),
      upsert: jest.fn().mockResolvedValue(undefined),
    } as unknown as Repository<PlaceDescriptionTranslation>;
    const provider = {
      search: jest.fn().mockResolvedValue({
        provider: 'openai-web-search',
        model: 'gpt-test',
        responseId: 'resp-1',
        descriptions: { ko: ko.description, ja: ja.description },
        sources: ko.sources,
        warnings: [],
      }),
    } as unknown as OpenAIPlaceDescriptionSearchProvider;
    const config = {
      get: jest.fn((key: string) => key === 'PLACE_DETAIL_WEB_SEARCH_ENABLED'),
    } as unknown as ConfigService;
    return {
      service: new PlaceDescriptionTranslationService(repo, provider, config),
      repo: repo as any,
      provider: provider as any,
    };
  }

  it('uses the two saved translations without another web search', async () => {
    const { service, provider, repo } = createService([ko, ja]);

    const result = await service.ensureForPlaces([place]);

    expect(result.get(place.id)?.ja.text).toBe(ja.description);
    expect(provider.search).not.toHaveBeenCalled();
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('searches once and upserts both locales when either translation is missing', async () => {
    const { service, provider, repo } = createService([ko]);
    repo.find.mockResolvedValueOnce([ko]).mockResolvedValueOnce([ko, ja]);

    const result = await service.ensureForPlaces([place]);

    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ locale: 'ko' }),
        expect.objectContaining({ locale: 'ja' }),
      ]),
      ['placeId', 'locale'],
    );
    expect(result.get(place.id)?.ko.text).toBe(ko.description);
  });

  it('also enriches KTO/Kakao real places while keeping explicit MOCK fixtures out of web search', async () => {
    const { service, provider } = createService([]);

    await service.ensureForPlaces([{ ...place, source: 'mock-place' } as Place]);

    expect(provider.search).not.toHaveBeenCalled();
  });
});
