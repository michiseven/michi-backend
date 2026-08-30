/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/explicit-function-return-type */
import type { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { OpenAIPlaceDetailSearchProvider } from './openai-place-detail-search.provider';
import type { PlaceDetailSearchInput } from './place-detail-evidence.types';

describe('OpenAIPlaceDetailSearchProvider', () => {
  const input: PlaceDetailSearchInput = {
    placeId: 'place-1',
    name: 'ソンスドン・テリムチャンゴ・ギャラリー（성수동 대림창고 갤러리）',
    localizedName: '성수동 대림창고 갤러리',
    address: '서울 성동구 성수동2가 322-32',
    roadAddress: '서울 성동구 성수이로 78',
    userQuery: '최신 영업시간과 가격을 알려줘',
    locale: 'ko',
  };

  function createProvider(outputParsed: any, sources: string[]) {
    const parse = jest.fn().mockResolvedValue({
      id: 'resp-web-1',
      model: 'gpt-5.6-luna',
      output_parsed: outputParsed,
      output: [
        {
          type: 'web_search_call',
          action: {
            type: 'search',
            sources: sources.map((url) => ({ type: 'url', url })),
          },
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
    return { provider: new OpenAIPlaceDetailSearchProvider(client, config), parse };
  }

  it('does not call OpenAI when paid web search is disabled', async () => {
    const parse = jest.fn();
    const provider = new OpenAIPlaceDetailSearchProvider(
      { responses: { parse } } as unknown as OpenAI,
      { get: jest.fn(() => false) } as unknown as ConfigService,
    );

    await expect(provider.search(input)).resolves.toBeNull();
    expect(parse).not.toHaveBeenCalled();
  });

  it('keeps only cited facts after exact name and address matching', async () => {
    const citedUrl = 'https://english.visitkorea.or.kr/place?item=1&utm_source=openai';
    const { provider, parse } = createProvider(
      {
        placeMatched: true,
        matchedName: '성수동 대림창고 갤러리',
        matchedAddress: '서울특별시 성동구 성수이로 78',
        businessHours: {
          status: 'sourced',
          value: '매일 11:00~22:00',
          sourceUrls: ['https://english.visitkorea.or.kr/place?item=1'],
        },
        price: {
          status: 'sourced',
          value: '아메리카노 6,500원',
          sourceUrls: ['https://english.visitkorea.or.kr/place?item=1'],
        },
        warnings: ['가격은 변경될 수 있습니다.'],
      },
      [citedUrl],
    );

    const result = await provider.search(input);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(result?.status).toBe('sourced');
    expect(result?.evidence.businessHours.value).toBe('매일 11:00~22:00');
    expect(result?.evidence.businessHours.sources[0]?.url).toBe(citedUrl);
  });

  it('rejects facts when the searched place identity does not match', async () => {
    const { provider } = createProvider(
      {
        placeMatched: true,
        matchedName: '대림미술관',
        matchedAddress: '서울 종로구 자하문로4길 21',
        businessHours: {
          status: 'sourced',
          value: '10:00~18:00',
          sourceUrls: ['https://example.com/wrong'],
        },
        price: { status: 'unavailable', value: null, sourceUrls: [] },
        warnings: [],
      },
      ['https://example.com/wrong'],
    );

    const result = await provider.search(input);

    expect(result?.status).toBe('unavailable');
    expect(result?.evidence.placeMatched).toBe(false);
    expect(result?.evidence.businessHours.value).toBeNull();
  });

  it('rejects a claimed match when name or address identity is missing', async () => {
    const { provider } = createProvider(
      {
        placeMatched: true,
        matchedName: null,
        matchedAddress: null,
        businessHours: {
          status: 'sourced',
          value: '매일 11:00~22:00',
          sourceUrls: ['https://example.com/place'],
        },
        price: { status: 'unavailable', value: null, sourceUrls: [] },
        warnings: [],
      },
      ['https://example.com/place'],
    );

    const result = await provider.search(input);

    expect(result?.evidence.placeMatched).toBe(false);
    expect(result?.evidence.businessHours.value).toBeNull();
  });

  it('rejects a value whose URL was not returned by the web search tool', async () => {
    const { provider } = createProvider(
      {
        placeMatched: true,
        matchedName: '성수동 대림창고 갤러리',
        matchedAddress: '서울 성동구 성수이로 78',
        businessHours: {
          status: 'sourced',
          value: '24시간',
          sourceUrls: ['https://uncited.example/hours'],
        },
        price: { status: 'unavailable', value: null, sourceUrls: [] },
        warnings: [],
      },
      ['https://cited.example/place'],
    );

    const result = await provider.search(input);

    expect(result?.status).toBe('unavailable');
    expect(result?.evidence.businessHours.value).toBeNull();
    expect(result?.evidence.businessHours.sources).toEqual([]);
  });

  it('preserves conflicts as null instead of selecting an arbitrary value', async () => {
    const { provider } = createProvider(
      {
        placeMatched: true,
        matchedName: '성수동 대림창고 갤러리',
        matchedAddress: '서울 성동구 성수이로 78',
        businessHours: { status: 'conflicting', value: null, sourceUrls: [] },
        price: { status: 'unavailable', value: null, sourceUrls: [] },
        warnings: ['출처별 영업시간이 다릅니다.'],
      },
      ['https://example.com/a', 'https://example.com/b'],
    );

    const result = await provider.search(input);

    expect(result?.status).toBe('conflicting');
    expect(result?.evidence.businessHours).toEqual({
      status: 'conflicting',
      value: null,
      sources: [],
    });
  });
});
