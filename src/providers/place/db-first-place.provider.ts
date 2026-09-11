import { Injectable } from '@nestjs/common';
import type { Place } from '../../database/entities';
import { categoryMatches } from '../../recommendation/deterministic-candidate-ranker';
import { PlaceCandidateSearchService } from './place-candidate-search.service';
import { SeoulSpatialAreaService } from './seoul-spatial-area.service';
import { NaverPlaceProvider } from './naver-place.provider';
import { PlaceNormalizer } from './place-normalizer';
import type {
  PlaceProvider,
  PlaceSearchRequest,
  ProviderPlaceRecord,
  PlaceSearchResponse,
} from './place-provider';

@Injectable()
export class DbFirstPlaceProvider implements PlaceProvider {
  readonly mode = 'live' as const;
  readonly name = 'db-first-naver';

  constructor(
    private readonly candidates: PlaceCandidateSearchService,
    private readonly spatial: SeoulSpatialAreaService,
    private readonly naver: NaverPlaceProvider,
    private readonly normalizer: PlaceNormalizer,
  ) {}

  async search(request: PlaceSearchRequest): Promise<PlaceSearchResponse> {
    const stored = await this.candidates.searchStoredCandidates({
      area: request.area,
      interests: request.role ? [request.role] : [],
      limit: 100,
    });
    const scoped = await this.spatial.filterCandidateCoordinates(request.area, stored);
    const cached = (scoped.applied ? scoped.places : []).filter((place) => {
      if (!place.location || !this.matchesRole(place.category, request.role, place.rawCategory)) {
        return false;
      }
      // A category hit alone cannot satisfy a more specific query such as
      // 한식, 비건 or 한옥 카페. Be conservative when deciding to skip NAVER.
      const evidence = `${place.name} ${place.rawCategory ?? ''}`.normalize('NFKC').toLowerCase();
      if (this.isSemanticDiscoveryQuery(request)) return true;
      return request.query
        .normalize('NFKC')
        .toLowerCase()
        .split(/\s+/u)
        .filter((term) => term && term !== request.area && term !== '서울')
        .every((term) => evidence.includes(term));
    });
    const records = cached.map((place): ProviderPlaceRecord => ({
      provider: place.source,
      providerMode: 'live',
      sourcePlaceId: place.sourcePlaceId,
      sourcePlaceIdKind: place.sourcePlaceId.startsWith('derived:') ? 'derived' : 'provider',
      name: place.name,
      rawCategory: place.rawCategory,
      address: place.address,
      roadAddress: place.roadAddress,
      longitude: place.location!.coordinates[0],
      latitude: place.location!.coordinates[1],
      rawPayload:
        (place.rawPayload?.sourceRecord as Record<string, unknown>) ?? place.rawPayload ?? {},
    }));
    // Keep multiple alternatives for route construction; one hit is not
    // sufficient coverage when another meal/activity needs the same role.
    const minimum = Math.min(request.limit ?? 3, 3);
    if (records.length >= minimum) {
      return {
        provider: this.name,
        providerMode: this.mode,
        query: request.query,
        places: records,
      };
    }
    const response = await this.naver.search(request);
    const normalized = response.places.map(
      (record) =>
        ({
          ...this.normalizer.normalize(record),
          id: `${record.provider}:${record.sourcePlaceId}`,
        }) as Place,
    );
    const filtered = await this.spatial.filterCandidateCoordinates(request.area, normalized);
    const allowed = new Set(
      (filtered.applied ? filtered.places : [])
        .filter((place) => this.matchesRole(place.category, request.role, place.rawCategory))
        .map((place) => place.id),
    );
    const found = response.places.filter((record) =>
      allowed.has(`${record.provider}:${record.sourcePlaceId}`),
    );
    const merged = new Map(
      [...records, ...found].map((record) => [
        `${record.provider}:${record.sourcePlaceId}`,
        record,
      ]),
    );
    return {
      provider: this.name,
      providerMode: this.mode,
      query: request.query,
      places: [...merged.values()],
    };
  }

  private matchesRole(
    category: string | null,
    role?: string,
    rawCategory?: string | null,
  ): boolean {
    if (!role || role === 'candidate') return true;
    // Older cached Naver rows may have been stored before a category mapping
    // was added. Their original provider category is still verified evidence,
    // so do not discard a 관광·명소 or gallery hit solely due to stale derived
    // category text.
    const raw = rawCategory ?? '';
    if (role === 'attraction' && /관광.*명소|여행.*명소|유적|궁/u.test(raw)) return true;
    if (role === 'culture' && /전시|박물|미술|갤러리|화랑|공방|공예|문화/u.test(raw)) return true;
    if (role === 'stroll') {
      return (
        category === 'park' ||
        category === 'stroll' ||
        ((category === 'attraction' || category === 'culture') &&
          /한옥마을|韓屋村|역사문화|전통마을|관광.*명소/u.test(raw))
      );
    }
    return categoryMatches(category, [role]);
  }

  private isSemanticDiscoveryQuery(request: PlaceSearchRequest): boolean {
    return (
      (request.role === 'stroll' && /산책로|하천변|정원|공원/u.test(request.query)) ||
      (request.role === 'photography' && /사진\s*명소|포토\s*스팟|전망\s*명소/u.test(request.query))
    );
  }
}
