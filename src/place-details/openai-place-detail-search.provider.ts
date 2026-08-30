import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { OPENAI_CLIENT } from '../ai/openai.provider';
import { PlaceDetailSearchOutputSchema } from './place-detail-search-output.schema';
import type {
  PlaceDetailEvidenceStatus,
  PlaceDetailFact,
  PlaceDetailFactStatus,
  PlaceDetailSearchInput,
  PlaceDetailSearchProvider,
  PlaceDetailSearchResult,
  PlaceDetailSource,
} from './place-detail-evidence.types';

const SYSTEM_INSTRUCTIONS = `You retrieve current public place details for a Seoul travel service.

Rules:
- Search the live web exactly once for the supplied place name AND address.
- Prefer the place's official website, official social account, Korea Tourism Organization, local government, or a recognized place platform.
- Do not use an unrelated place with the same or similar name.
- Never infer business hours, holidays, prices, menu items, or price ranges.
- A field is sourced only when one or more returned source URLs directly support its value.
- Mark a field conflicting and set its value to null when credible sources disagree.
- Mark a field unavailable and set its value to null when no direct source exists.
- sourceUrls must contain only URLs actually found during this web search.
- Prices must retain their currency and scope. Do not turn a few menu samples into a general average.
- Keep warnings concise and factual.`;

function normalizeIdentity(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/서울특별시/g, '서울')
    .replace(/[^가-힣a-z0-9]/g, '');
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
  input: PlaceDetailSearchInput,
  matchedName: string | null,
  matchedAddress: string | null,
): boolean {
  const expectedNames = [input.name, input.localizedName]
    .map(normalizeIdentity)
    .filter((value) => value.length >= 2);
  const actualName = normalizeIdentity(matchedName);
  if (actualName.length < 2) return false;
  const nameMatches = expectedNames.some(
    (name) => actualName.includes(name) || name.includes(actualName),
  );
  if (!nameMatches) return false;

  const expectedAddresses = [input.roadAddress, input.address]
    .map(normalizeIdentity)
    .filter((value) => value.length >= 5);
  if (expectedAddresses.length === 0) return true;

  const actualAddress = normalizeIdentity(matchedAddress);
  if (actualAddress.length < 5) return false;
  return expectedAddresses.some(
    (address) => actualAddress.includes(address) || address.includes(actualAddress),
  );
}

function resultStatus(hours: PlaceDetailFact, price: PlaceDetailFact): PlaceDetailEvidenceStatus {
  const facts = [hours, price];
  if (facts.some((fact) => fact.status === 'conflicting')) return 'conflicting';
  const sourcedCount = facts.filter((fact) => fact.status === 'sourced').length;
  if (sourcedCount === facts.length) return 'sourced';
  if (sourcedCount > 0) return 'partial';
  return 'unavailable';
}

@Injectable()
export class OpenAIPlaceDetailSearchProvider implements PlaceDetailSearchProvider {
  private readonly logger = new Logger(OpenAIPlaceDetailSearchProvider.name);

  constructor(
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI | null,
    private readonly config: ConfigService,
  ) {}

  async search(input: PlaceDetailSearchInput): Promise<PlaceDetailSearchResult | null> {
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
          { role: 'system', content: SYSTEM_INSTRUCTIONS },
          {
            role: 'user',
            content: JSON.stringify({
              place: {
                name: input.name,
                localizedName: input.localizedName,
                address: input.address,
                roadAddress: input.roadAddress,
              },
              requestedInformation: input.userQuery,
              requiredFields: ['businessHours', 'price'],
              outputLocale: input.locale,
            }),
          },
        ],
        text: {
          format: zodTextFormat(PlaceDetailSearchOutputSchema, 'place_detail_evidence'),
        },
        max_output_tokens: 1200,
        max_tool_calls: 6,
        store: false,
      });

      const parsed = response.output_parsed;
      if (!parsed) return null;

      const citedSources = new Map<string, PlaceDetailSource>();
      for (const item of response.output) {
        if (item.type === 'web_search_call' && item.action.type === 'search') {
          for (const source of item.action.sources ?? []) {
            const canonical = canonicalUrl(source.url);
            if (!canonical) continue;
            citedSources.set(canonical, {
              title: new URL(source.url).hostname,
              url: source.url,
            });
          }
        }
        if (item.type === 'message') {
          for (const content of item.content) {
            if (content.type !== 'output_text') continue;
            for (const annotation of content.annotations) {
              if (annotation.type !== 'url_citation') continue;
              const canonical = canonicalUrl(annotation.url);
              if (!canonical) continue;
              citedSources.set(canonical, {
                title: annotation.title,
                url: annotation.url,
              });
            }
          }
        }
      }

      const placeMatched =
        parsed.placeMatched && identityMatches(input, parsed.matchedName, parsed.matchedAddress);

      const validateFact = (
        status: PlaceDetailFactStatus,
        value: string | null,
        sourceUrls: string[],
      ): PlaceDetailFact => {
        if (!placeMatched || status !== 'sourced' || !value) {
          return {
            status: status === 'conflicting' ? 'conflicting' : 'unavailable',
            value: null,
            sources: [],
          };
        }

        const sources = sourceUrls
          .map((url) => canonicalUrl(url))
          .filter((url): url is string => Boolean(url))
          .map((url) => citedSources.get(url))
          .filter((source): source is PlaceDetailSource => Boolean(source));

        const uniqueSources = [
          ...new Map(sources.map((source) => [source.url, source])).values(),
        ].slice(0, 5);
        if (uniqueSources.length === 0) {
          return { status: 'unavailable', value: null, sources: [] };
        }
        return { status: 'sourced', value: value.trim(), sources: uniqueSources };
      };

      const businessHours = validateFact(
        parsed.businessHours.status,
        parsed.businessHours.value,
        parsed.businessHours.sourceUrls,
      );
      const price = validateFact(parsed.price.status, parsed.price.value, parsed.price.sourceUrls);
      const warnings = [
        ...new Set(parsed.warnings.map((warning) => warning.trim()).filter(Boolean)),
      ];
      if (!placeMatched) {
        warnings.unshift('검색 결과의 장소명과 주소가 요청한 장소와 일치하지 않았습니다.');
      }

      return {
        provider: 'openai-web-search',
        model: response.model || model,
        responseId: response.id,
        status: resultStatus(businessHours, price),
        evidence: {
          placeMatched,
          matchedName: parsed.matchedName,
          matchedAddress: parsed.matchedAddress,
          businessHours,
          price,
          warnings: warnings.slice(0, 8),
        },
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Place detail web search failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }
}
