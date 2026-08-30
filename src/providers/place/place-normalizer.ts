import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isNorthKoreaRelated } from '../../common/utils/security-filter.util';
import type { GeoPoint } from '../../database/entities';
import type { ProviderPlaceRecord } from './place-provider';

export interface NormalizedPlace {
  source: string;
  sourcePlaceId: string;
  name: string;
  category: string | null;
  address: string | null;
  roadAddress: string | null;
  location: GeoPoint | null;
  district: string | null;
  rawCategory: string | null;
  rawPayload: Record<string, unknown>;
}

export interface NaverLocalItem {
  title?: unknown;
  link?: unknown;
  category?: unknown;
  description?: unknown;
  telephone?: unknown;
  address?: unknown;
  roadAddress?: unknown;
  mapx?: unknown;
  mapy?: unknown;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .trim();
}

function naverCoordinate(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const integer = Number(value);
  if (!Number.isFinite(integer)) {
    return null;
  }
  const coordinate = integer / 10_000_000;
  return coordinate >= min && coordinate <= max ? coordinate : null;
}

function deriveSourceId(item: NaverLocalItem): string {
  const rawTitle = optionalString(item.title);
  const normalizedTitle = rawTitle ? stripHtml(rawTitle) : '';
  const fingerprint = [
    normalizedTitle,
    optionalString(item.roadAddress) ?? optionalString(item.address) ?? '',
    optionalString(item.mapx) ?? '',
    optionalString(item.mapy) ?? '',
  ].join('|');
  return `derived:${createHash('sha256').update(fingerprint).digest('hex')}`;
}

export function isMedicalCategoryOrName(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return (
    /a020205/.test(normalized) ||
    /병원|의원|클리닉|クリニック|clinic|성형외과|피부과|치과|안과|한의원|산부인과|내과|외과|정형외과|이비인후과|비뇨기과|도수치료|마사지|약국|pharmacy/.test(
      normalized,
    )
  );
}

function normalizeCategory(rawCategory: string | null): string | null {
  if (!rawCategory) {
    return null;
  }
  const fullCategory = rawCategory.trim().toLowerCase();

  if (isMedicalCategoryOrName(fullCategory)) {
    return 'medical';
  }

  const ktoContentType = /^kto:(75|76|77|78|79|80|81|82|85)(?::|$)/.exec(fullCategory)?.[1];
  if (ktoContentType === '76' || ktoContentType === '79') return 'attraction';
  if (ktoContentType === '77' || ktoContentType === '78') return 'culture';
  if (ktoContentType === '75' || ktoContentType === '80') return 'leisure';
  if (ktoContentType === '81') return 'lodging';
  if (ktoContentType === '82') return 'shopping';
  if (ktoContentType === '85') return 'restaurant';
  if (/카페|커피/.test(fullCategory)) return 'cafe';
  if (
    /음식점|한식|일식|중식|양식|세계음식|아시아음식|분식|뷔페|술집|고기|육류|restaurant/.test(
      fullCategory,
    )
  )
    return 'restaurant';
  const leaf = fullCategory.split('>').at(-1)?.trim() ?? '';
  if (/패션|의류|편집|쇼핑/.test(leaf)) return 'shopping';
  if (/공원|자연/.test(leaf)) return 'park';
  if (/미술관|박물관|전시/.test(leaf)) return 'culture';
  return leaf.length > 0 ? leaf : null;
}

function districtFromAddress(address: string | null): string | null {
  if (!address) return null;
  const district = address.split(/\s+/).find((part) => part.endsWith('구'));
  return district ?? null;
}

export function normalizeNaverLocalItem(item: NaverLocalItem): ProviderPlaceRecord | null {
  const rawTitle = optionalString(item.title);
  const address = optionalString(item.address);
  const roadAddress = optionalString(item.roadAddress);
  const category = optionalString(item.category);
  const description = optionalString(item.description);

  if (
    isNorthKoreaRelated(rawTitle) ||
    isNorthKoreaRelated(address) ||
    isNorthKoreaRelated(roadAddress) ||
    isNorthKoreaRelated(category) ||
    isNorthKoreaRelated(description)
  ) {
    return null;
  }

  if (!rawTitle || ![address, roadAddress].some((value) => value?.startsWith('서울'))) {
    return null;
  }

  const longitude = naverCoordinate(item.mapx, -180, 180);
  const latitude = naverCoordinate(item.mapy, -90, 90);

  return {
    provider: 'naver-local',
    providerMode: 'live',
    sourcePlaceId: deriveSourceId(item),
    sourcePlaceIdKind: 'derived',
    name: stripHtml(rawTitle),
    rawCategory: optionalString(item.category),
    address,
    roadAddress,
    longitude,
    latitude,
    rawPayload: { ...item },
  };
}

@Injectable()
export class PlaceNormalizer {
  normalize(record: ProviderPlaceRecord): NormalizedPlace {
    const location =
      record.longitude !== null && record.latitude !== null
        ? {
            type: 'Point' as const,
            coordinates: [record.longitude, record.latitude] as [number, number],
          }
        : null;
    return {
      source: record.provider,
      sourcePlaceId: record.sourcePlaceId,
      name: record.name,
      category: normalizeCategory(record.rawCategory),
      address: record.address,
      roadAddress: record.roadAddress,
      location,
      district: districtFromAddress(record.roadAddress ?? record.address),
      rawCategory: record.rawCategory,
      rawPayload: {
        sourceRecord: { ...record.rawPayload },
        normalization: {
          providerMode: record.providerMode,
          sourcePlaceIdKind: record.sourcePlaceIdKind,
        },
      },
    };
  }
}
