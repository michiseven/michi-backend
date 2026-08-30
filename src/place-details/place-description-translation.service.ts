import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Place, PlaceDescriptionTranslation } from '../database/entities';
import { OpenAIPlaceDescriptionSearchProvider } from './openai-place-description-search.provider';

export interface LocalizedPlaceDescription {
  text: string;
  sources: Array<{ title: string; url: string }>;
  fetchedAt: string;
  provider: 'openai-web-search';
}

@Injectable()
export class PlaceDescriptionTranslationService {
  private readonly logger = new Logger(PlaceDescriptionTranslationService.name);

  constructor(
    @InjectRepository(PlaceDescriptionTranslation)
    private readonly translations: Repository<PlaceDescriptionTranslation>,
    private readonly provider: OpenAIPlaceDescriptionSearchProvider,
    private readonly config: ConfigService,
  ) {}

  /**
   * 실제 Provider 장소의 ko/ja 소개문을 보강한다. 두 언어가 모두 DB에 있으면 외부 호출 없이
   * 반환하며, 누락된 장소는 장소당 웹 검색 1회로 두 행을 함께 upsert한다. 명시적 MOCK fixture는
   * 실제 장소처럼 검색/번역하지 않는다.
   */
  async ensureForPlaces(
    places: Place[],
  ): Promise<Map<string, Record<'ko' | 'ja', LocalizedPlaceDescription>>> {
    const eligiblePlaces = places.filter((place) => place.source !== 'mock-place');
    const result = new Map<string, Record<'ko' | 'ja', LocalizedPlaceDescription>>();
    if (
      eligiblePlaces.length === 0 ||
      !this.config.get<boolean>('PLACE_DETAIL_WEB_SEARCH_ENABLED')
    ) {
      return result;
    }

    const placeIds = [...new Set(eligiblePlaces.map((place) => place.id))];
    const existing = await this.translations.find({ where: { placeId: In(placeIds) } });
    const byPlace = new Map<string, Map<'ko' | 'ja', PlaceDescriptionTranslation>>();
    for (const translation of existing) {
      const locale = translation.locale;
      const localized =
        byPlace.get(translation.placeId) ?? new Map<'ko' | 'ja', PlaceDescriptionTranslation>();
      localized.set(locale, translation);
      byPlace.set(translation.placeId, localized);
    }

    for (const place of eligiblePlaces) {
      let localized = byPlace.get(place.id) ?? new Map<'ko' | 'ja', PlaceDescriptionTranslation>();
      if (!localized.has('ko') || !localized.has('ja')) {
        try {
          const searched = await this.provider.search({
            placeId: place.id,
            name: place.name,
            address: place.address,
            roadAddress: place.roadAddress,
          });
          if (searched) {
            const rows = (['ko', 'ja'] as const).map((locale) => ({
              placeId: place.id,
              locale,
              description: searched.descriptions[locale],
              provider: searched.provider,
              model: searched.model,
              responseId: searched.responseId,
              sources: searched.sources,
            }));
            await this.translations.upsert(rows, ['placeId', 'locale']);
            const savedRows = await this.translations.find({ where: { placeId: place.id } });
            localized = new Map(savedRows.map((row) => [row.locale, row]));
            byPlace.set(place.id, localized);
          }
        } catch (error: unknown) {
          this.logger.warn(
            `Could not save place descriptions for ${place.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
      }
      if (localized.has('ko') && localized.has('ja')) {
        result.set(place.id, {
          ko: this.toView(localized.get('ko')!),
          ja: this.toView(localized.get('ja')!),
        });
      }
    }
    return result;
  }

  private toView(row: PlaceDescriptionTranslation): LocalizedPlaceDescription {
    return {
      text: row.description,
      sources: row.sources,
      fetchedAt: row.fetchedAt.toISOString(),
      provider: row.provider,
    };
  }
}
