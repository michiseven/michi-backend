import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Place } from '../database/entities';
import { KTO_PLACE_SOURCE } from '../providers/place/kto-place.provider';
import {
  KTO_DATALAB_CONCENTRATION_DATASET_KEY,
  KTO_DATALAB_CONCENTRATION_DATASET_URL,
  KtoDataLabConcentrationProvider,
  SEOUL_DATALAB_DISTRICTS,
  type KtoConcentrationForecast,
  type SeoulDataLabDistrict,
} from './kto-datalab-concentration.provider';
import { TourismDataImportService } from './tourism-data-import.service';
import type { CanonicalTourismMetric, TourismImportSummary } from './tourism-data.types';

export interface KtoDataLabConcentrationSyncOptions {
  districtNames?: readonly string[];
  pageSize?: number;
}

export interface KtoDataLabConcentrationSyncSummary {
  districts: number;
  pages: number;
  fetched: number;
  rejectedByProvider: number;
  matchedRows: number;
  matchedPlaces: number;
  unmatchedAttractions: number;
  ambiguousAttractions: number;
  referencePeriod: string | null;
  import: TourismImportSummary;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function comparable(value: string): string {
  return decodeHtmlEntities(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Balanced bracket extraction supporting (), （）, [], 【】, {}, 〈〉, 《》 */
export function extractParenthesisBlocks(value: string): string[] {
  const blocks: string[] = [];
  const openChars = new Set(['(', '（', '[', '【', '{', '〈', '《']);
  const closeChars = new Set([')', '）', ']', '】', '}', '〉', '》']);
  let depth = 0;
  let current = '';

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (openChars.has(ch)) {
      if (depth > 0) current += ch;
      depth++;
    } else if (closeChars.has(ch)) {
      depth--;
      if (depth === 0) {
        if (current.trim()) blocks.push(current.trim());
        current = '';
      } else if (depth > 0) {
        current += ch;
      }
    } else if (depth > 0) {
      current += ch;
    }
  }
  return blocks;
}

/** KTO Japanese titles often retain the Korean source title inside parentheses. */
export function ktoPlaceNameAliases(value: string): string[] {
  const aliases = new Set<string>();
  const whole = comparable(value);
  if (whole) aliases.add(whole);

  // 1. Extract all parenthesized blocks (e.g. (한국어명), (DDP), (홍대) etc.)
  const blocks = extractParenthesisBlocks(value);
  for (const block of blocks) {
    const norm = comparable(block);
    if (norm) aliases.add(norm);

    // If block has inner nested parens, extract without them
    const innerStripped = block.replace(/[（([{}<【《][^）)\]}>】》]*[）)\]}>】》]/g, '').trim();
    const innerNorm = comparable(innerStripped);
    if (innerNorm) aliases.add(innerNorm);

    // Extract Korean/Latin alphanumeric runs from the block
    const koreanLatinBlock =
      block.match(/[\p{Script=Hangul}\p{Script=Latin}\d]+/gu)?.join('') ?? '';
    const koreanLatinNorm = comparable(koreanLatinBlock);
    if (koreanLatinNorm) aliases.add(koreanLatinNorm);
  }

  // 2. Base title with all parenthesized blocks removed (e.g. "切手博物館")
  const strippedParens = value.replace(/[（([{}<【《][^）)\]}>】》]*[）)\]}>】》]/g, '').trim();
  const strippedNorm = comparable(strippedParens);
  if (strippedNorm) aliases.add(strippedNorm);

  // 3. Extract Hangul+Latin+Digit run from full string if containing Hangul
  const fullKoreanLatin = value.match(/[\p{Script=Hangul}\p{Script=Latin}\d]+/gu)?.join('') ?? '';
  if (/[\p{Script=Hangul}]/u.test(fullKoreanLatin)) {
    const c = comparable(fullKoreanLatin);
    if (c) aliases.add(c);
  }

  return [...aliases];
}

/** Generate conservative normalized aliases for DataLab attraction names. */
export function datalabAttractionAliases(attractionName: string): string[] {
  const aliases = new Set<string>();
  const base = comparable(attractionName);
  if (base) aliases.add(base);

  // 1. Strip former name / UNESCO heritage qualifiers: (구. ...), (구 ...), [유네스코...], (현 ...)
  const strippedQualifiers = attractionName
    .replace(/[（([{}<【《](?:구[.\s]|유네스코|현\b)[^）)\]}>】》]*[）)\]}>】》]/g, '')
    .trim();
  const strippedQualifiersNorm = comparable(strippedQualifiers);
  if (strippedQualifiersNorm) aliases.add(strippedQualifiersNorm);

  // 2. Strip region suffix: (서울), (종로)
  const strippedRegion = attractionName
    .replace(/[（([{}<【《](?:서울|종로|강남|중구)[^）)\]}>】》]*[）)\]}>】》]/g, '')
    .trim();
  const strippedRegionNorm = comparable(strippedRegion);
  if (strippedRegionNorm) aliases.add(strippedRegionNorm);

  // 3. Extract parenthesized blocks inside attraction name if any
  const blocks = extractParenthesisBlocks(attractionName);
  for (const block of blocks) {
    const norm = comparable(block);
    if (norm) aliases.add(norm);
  }

  return [...aliases];
}

export function uniqueKtoPlaceMatch(
  attractionName: string,
  placesByAlias: ReadonlyMap<string, readonly Place[]>,
): Place | null | 'ambiguous' {
  const aliases = datalabAttractionAliases(attractionName);
  const matchedPlaces = new Map<string, Place>();

  for (const alias of aliases) {
    const candidates = placesByAlias.get(alias) ?? [];
    for (const candidate of candidates) {
      matchedPlaces.set(candidate.id, candidate);
    }
  }

  if (matchedPlaces.size === 0) return null;
  if (matchedPlaces.size > 1) return 'ambiguous';
  return [...matchedPlaces.values()][0]!;
}

function period(records: readonly KtoConcentrationForecast[]): {
  start: string | null;
  end: string | null;
  label: string | null;
} {
  const dates = records.map((record) => record.forecastDate).sort();
  const start = dates[0] ?? null;
  const end = dates.at(-1) ?? null;
  return { start, end, label: start && end ? `${start}~${end}` : null };
}

function metric(record: KtoConcentrationForecast, place: Place): CanonicalTourismMetric {
  return {
    areaCode: record.districtCode,
    areaName: record.districtName,
    placeSource: place.source,
    sourcePlaceId: place.sourcePlaceId,
    metricType: 'concentration_forecast_index',
    value: record.concentrationIndex,
    unit: 'relative_index_0_100',
    periodStart: record.forecastDate,
    periodEnd: record.forecastDate,
    dimensions: { forecastWindow: 'next_30_days' },
    metadata: {
      sourceField: 'cnctrRate',
      forecastAttractionName: record.attractionName,
      areaCode: record.areaCode,
      districtCode: record.districtCode,
      matchMethod: 'exact_normalized_name_or_korean_alias',
      meaning: '가장 붐비는 시기를 100으로 둔 상대 예측 지수',
    },
  };
}

function districtsFor(names: readonly string[] | undefined): SeoulDataLabDistrict[] {
  if (!names || names.length === 0) return [...SEOUL_DATALAB_DISTRICTS];
  const wanted = new Set(names.map((name) => name.normalize('NFKC').trim()));
  const selected = SEOUL_DATALAB_DISTRICTS.filter((district) => wanted.has(district.name));
  const missing = [...wanted].filter(
    (name) => !selected.some((district) => district.name === name),
  );
  if (missing.length > 0) throw new Error(`Unsupported Seoul district: ${missing.join(', ')}`);
  return selected;
}

@Injectable()
export class KtoDataLabConcentrationSyncService {
  constructor(
    @InjectRepository(Place) private readonly places: Repository<Place>,
    private readonly provider: KtoDataLabConcentrationProvider,
    private readonly importer: TourismDataImportService,
  ) {}

  async synchronize(
    options: KtoDataLabConcentrationSyncOptions = {},
  ): Promise<KtoDataLabConcentrationSyncSummary> {
    const districts = districtsFor(options.districtNames);
    const pageSize = options.pageSize ?? 10_000;
    const placeRows = await this.places.find({ where: { source: KTO_PLACE_SOURCE } });
    const placesByAlias = new Map<string, Place[]>();
    for (const place of placeRows) {
      for (const alias of ktoPlaceNameAliases(place.name)) {
        placesByAlias.set(alias, [...(placesByAlias.get(alias) ?? []), place]);
      }
    }

    const results = [];
    for (const district of districts) {
      results.push(await this.provider.fetchDistrict(district, pageSize));
    }
    const records = results.flatMap((result) => result.records);
    const matchedMetrics: CanonicalTourismMetric[] = [];
    const matchedPlaceIds = new Set<string>();
    const unmatched = new Set<string>();
    const ambiguous = new Set<string>();
    for (const record of records) {
      const place = uniqueKtoPlaceMatch(record.attractionName, placesByAlias);
      if (place === 'ambiguous') {
        ambiguous.add(`${record.districtCode}:${record.attractionName}`);
      } else if (!place) {
        unmatched.add(`${record.districtCode}:${record.attractionName}`);
      } else {
        matchedMetrics.push(metric(record, place));
        matchedPlaceIds.add(place.id);
      }
    }
    if (matchedMetrics.length === 0) {
      throw new Error(
        'KTO DataLab returned no forecast rows that matched a synchronized KTO Place',
      );
    }

    const reference = period(records);
    const document = {
      schemaVersion: 'michi-tourism-metric-v1' as const,
      source: {
        datasetKey: KTO_DATALAB_CONCENTRATION_DATASET_KEY,
        name: '관광지 집중률 방문자 추이 예측 정보',
        sourceName: '한국관광공사',
        url: KTO_DATALAB_CONCENTRATION_DATASET_URL,
        licenseUseCondition: '공공데이터포털 이용허락범위 제한 없음; 출처 표시',
        updateCycle: '실시간(공공데이터포털 표기)',
        spatialGranularity: '관광지점',
        temporalGranularity: '일(조회일 기준 향후 30일 예측)',
        apiAvailable: true,
        csvAvailable: false,
        metadata: {
          publicDataId: '15128555',
          sourceModel: 'KT 이동통신 기반 한국관광공사 예측',
          caveat: '실측 방문자 수나 실시간 혼잡도가 아닌 상대 예측 지수',
        },
      },
      referencePeriod: reference.label,
      mode: 'live' as const,
      metrics: matchedMetrics,
    };
    const matchingDiagnostics = {
      districts: districts.length,
      pages: results.reduce((sum, result) => sum + result.pages, 0),
      fetched: records.length,
      rejectedByProvider: results.reduce((sum, result) => sum + result.rejectedCount, 0),
      matchedRows: matchedMetrics.length,
      matchedPlaces: matchedPlaceIds.size,
      unmatchedAttractions: unmatched.size,
      ambiguousAttractions: ambiguous.size,
      referencePeriod: reference.label,
      matchingPolicyVersion: 'kto-datalab-matching-v2-paren-alias',
    };
    const bytes = Buffer.from(JSON.stringify(document));
    const imported = await this.importer.importBuffer({
      fileName: `kto-datalab-concentration-${reference.start ?? 'unknown'}-${reference.end ?? 'unknown'}.json`,
      bytes,
      format: 'json',
      runMetadata: matchingDiagnostics,
    });

    return {
      ...matchingDiagnostics,
      import: imported,
    };
  }
}
