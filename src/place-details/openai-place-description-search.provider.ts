import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { OPENAI_CLIENT } from '../ai/openai.provider';
import type { PlaceDescriptionSource } from '../database/entities/place-description-translation.entity';
import { PlaceDescriptionSearchOutputSchema } from './place-description-search-output.schema';

export interface PlaceDescriptionSearchInput {
  placeId: string;
  name: string;
  address: string | null;
  roadAddress: string | null;
}

export interface PlaceDescriptionSearchResult {
  provider: 'openai-web-search';
  model: string;
  responseId: string;
  descriptions: { ko: string; ja: string };
  sources: PlaceDescriptionSource[];
  warnings: string[];
}

const INSTRUCTIONS = `You create a short, source-grounded introduction for one Seoul place.

Rules:
- Search for the supplied place name AND address. Never use a similarly named place.
- Use only facts that are directly supported by sources returned by this web search.
- Do not include opening hours, prices, menus, crowd level, subjective atmosphere, rankings, or claims not supported by sources.
- Write one concise neutral description in Korean and its faithful Japanese translation. Each must be 1-2 sentences, max 300 Korean/Japanese characters.
- The Japanese text is a translation of the Korean text, not a different claim.
- If exact identity cannot be confirmed, set both descriptions to null.
- sourceUrls must only contain URLs returned by this web search.
- Do not output markdown, links, or citations inside descriptions. Keep warnings factual.`;

function normalizeIdentity(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/서울특별시/g, '서울')
    .replace(/[^가-힣ぁ-ゟ゠-ヿ一-龯a-z0-9]/g, '');
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_')) url.searchParams.delete(key);
    }
    const query = url.searchParams.toString();
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}${query ? `?${query}` : ''}`;
  } catch {
    return null;
  }
}

function identityMatches(
  input: PlaceDescriptionSearchInput,
  matchedName: string | null,
  matchedAddress: string | null,
): boolean {
  const expectedName = normalizeIdentity(input.name);
  const actualName = normalizeIdentity(matchedName);
  if (expectedName.length < 2 || actualName.length < 2) return false;
  if (!actualName.includes(expectedName) && !expectedName.includes(actualName)) return false;

  const expectedAddresses = [input.roadAddress, input.address]
    .map(normalizeIdentity)
    .filter((value) => value.length >= 5);
  if (expectedAddresses.length === 0) return true;
  const actualAddress = normalizeIdentity(matchedAddress);
  return (
    actualAddress.length >= 5 &&
    expectedAddresses.some(
      (address) => actualAddress.includes(address) || address.includes(actualAddress),
    )
  );
}

@Injectable()
export class OpenAIPlaceDescriptionSearchProvider {
  private readonly logger = new Logger(OpenAIPlaceDescriptionSearchProvider.name);

  constructor(
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI | null,
    private readonly config: ConfigService,
  ) {}

  async search(input: PlaceDescriptionSearchInput): Promise<PlaceDescriptionSearchResult | null> {
    if (!this.client || !this.config.get<boolean>('PLACE_DETAIL_WEB_SEARCH_ENABLED')) return null;
    const model =
      this.config.get<string>('OPENAI_WEB_SEARCH_MODEL') ??
      this.config.get<string>('OPENAI_MODEL') ??
      'gpt-5.6-luna';
    try {
      const response = await this.client.responses.parse({
        model,
        tools: [
          {
            type: 'web_search',
            search_context_size: 'low',
            external_web_access: true,
            user_location: {
              type: 'approximate',
              country: 'KR',
              city: 'Seoul',
              timezone: 'Asia/Seoul',
            },
          },
        ],
        tool_choice: 'required',
        include: ['web_search_call.action.sources'],
        input: [
          { role: 'system', content: INSTRUCTIONS },
          {
            role: 'user',
            content: JSON.stringify({ place: input, requiredLocales: ['ko', 'ja'] }),
          },
        ],
        text: { format: zodTextFormat(PlaceDescriptionSearchOutputSchema, 'place_description') },
        // 이 작업은 사실 확인·짧은 번역만 필요하므로 reasoning 예산을 낮춘다.
        // 전체 백필에서 TPM 초과를 줄이되, 장소/주소/출처 검증은 서버에서 그대로 수행한다.
        reasoning: { effort: 'low' },
        max_output_tokens: 600,
        // 장소 소개는 정확히 식별된 단일 출처면 충분하다. 백필 중 불필요한 재검색을 막는다.
        max_tool_calls: 1,
        store: false,
      });
      const parsed = response.output_parsed;
      if (!parsed || !parsed.placeMatched) return null;
      if (!identityMatches(input, parsed.matchedName, parsed.matchedAddress)) return null;
      if (!parsed.descriptionKo || !parsed.descriptionJa) return null;

      const returnedSources = new Map<string, PlaceDescriptionSource>();
      for (const item of response.output) {
        if (item.type !== 'web_search_call' || item.action.type !== 'search') continue;
        for (const source of item.action.sources ?? []) {
          const canonical = canonicalUrl(source.url);
          if (canonical)
            returnedSources.set(canonical, {
              title: new URL(source.url).hostname,
              url: source.url,
            });
        }
      }
      const sources = [
        ...new Map(
          parsed.sourceUrls
            .map(canonicalUrl)
            .filter((url): url is string => Boolean(url))
            .map((url) => returnedSources.get(url))
            .filter((source): source is PlaceDescriptionSource => Boolean(source))
            .map((source) => [source.url, source]),
        ).values(),
      ].slice(0, 5);
      if (sources.length === 0) return null;

      return {
        provider: 'openai-web-search',
        model: response.model || model,
        responseId: response.id,
        descriptions: { ko: parsed.descriptionKo.trim(), ja: parsed.descriptionJa.trim() },
        sources,
        warnings: [
          ...new Set(parsed.warnings.map((warning) => warning.trim()).filter(Boolean)),
        ].slice(0, 8),
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Place description web search failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }
}
