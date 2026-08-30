/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/explicit-function-return-type */
import type { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { OpenAIPlaceDescriptionSearchProvider } from './openai-place-description-search.provider';

describe('OpenAIPlaceDescriptionSearchProvider', () => {
  const input = {
    placeId: 'place-1',
    name: '미라클스터디카페 마포공덕센터',
    address: '서울 마포구 마포대로 92',
    roadAddress: '서울 마포구 마포대로 92',
  };

  function createProvider(outputParsed: any, sourceUrls: string[]) {
    const parse = jest.fn().mockResolvedValue({
      id: 'resp-description-1',
      model: 'gpt-5.6-luna',
      output_parsed: outputParsed,
      output: [
        {
          type: 'web_search_call',
          action: { type: 'search', sources: sourceUrls.map((url) => ({ type: 'url', url })) },
        },
      ],
    });
    const client = { responses: { parse } } as unknown as OpenAI;
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'PLACE_DETAIL_WEB_SEARCH_ENABLED') return true;
        if (key === 'OPENAI_WEB_SEARCH_MODEL') return 'gpt-5.6-luna';
        return undefined;
      }),
    } as unknown as ConfigService;
    return { provider: new OpenAIPlaceDescriptionSearchProvider(client, config), parse };
  }

  it('does not call OpenAI when paid web search is disabled', async () => {
    const parse = jest.fn();
    const provider = new OpenAIPlaceDescriptionSearchProvider(
      { responses: { parse } } as unknown as OpenAI,
      { get: jest.fn(() => false) } as unknown as ConfigService,
    );

    await expect(provider.search(input)).resolves.toBeNull();
    expect(parse).not.toHaveBeenCalled();
  });

  it('stores a Korean description and faithful Japanese translation only with a returned source', async () => {
    const source = 'https://example.com/place?utm_source=openai';
    const { provider, parse } = createProvider(
      {
        placeMatched: true,
        matchedName: '미라클스터디카페 마포공덕센터',
        matchedAddress: '서울특별시 마포구 마포대로 92',
        descriptionKo: '마포대로에 위치한 스터디카페입니다.',
        descriptionJa: '麻浦大路に位置するスタディカフェです。',
        sourceUrls: ['https://example.com/place'],
        warnings: [],
      },
      [source],
    );

    const result = await provider.search(input);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(result?.descriptions.ko).toBe('마포대로에 위치한 스터디카페입니다.');
    expect(result?.descriptions.ja).toBe('麻浦大路に位置するスタディカフェです。');
    expect(result?.sources).toEqual([{ title: 'example.com', url: source }]);
  });

  it('rejects descriptions if the place identity differs', async () => {
    const { provider } = createProvider(
      {
        placeMatched: true,
        matchedName: '미라클스터디카페 강남센터',
        matchedAddress: '서울 강남구 테헤란로 1',
        descriptionKo: '강남의 스터디카페입니다.',
        descriptionJa: '江南のスタディカフェです。',
        sourceUrls: ['https://example.com/wrong'],
        warnings: [],
      },
      ['https://example.com/wrong'],
    );

    await expect(provider.search(input)).resolves.toBeNull();
  });

  it('rejects a description when its claimed source was not returned by web search', async () => {
    const { provider } = createProvider(
      {
        placeMatched: true,
        matchedName: '미라클스터디카페 마포공덕센터',
        matchedAddress: '서울 마포구 마포대로 92',
        descriptionKo: '마포대로에 위치한 스터디카페입니다.',
        descriptionJa: '麻浦大路に位置するスタディカフェです。',
        sourceUrls: ['https://uncited.example/place'],
        warnings: [],
      },
      ['https://example.com/place'],
    );

    await expect(provider.search(input)).resolves.toBeNull();
  });
});
