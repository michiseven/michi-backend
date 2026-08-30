import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Place } from '../../database/entities';
import { KTO_PLACE_SOURCE } from './kto-place.provider';
import { knownSeoulSearchArea } from './seoul-area-centers';
import { SeoulSpatialAreaService } from './seoul-spatial-area.service';
import { verifiedPlacePrice } from './place-price-evidence';

const INTEREST_CATEGORIES: Readonly<Record<string, string>> = {
  cafe: 'cafe',
  select_shop: 'shopping',
  shopping: 'shopping',
  meat: 'restaurant',
  food: 'restaurant',
  park: 'park',
  culture: 'culture',
};

export interface PlaceCandidateSearchRequest {
  area: string;
  interests?: string[];
  radiusMeters?: number;
  limit?: number;
}

@Injectable()
export class PlaceCandidateSearchService {
  constructor(
    @InjectRepository(Place) private readonly places: Repository<Place>,
    private readonly spatialAreas?: SeoulSpatialAreaService,
  ) {}

  async searchKtoCandidates(request: PlaceCandidateSearchRequest): Promise<Place[]> {
    const limit = Math.min(Math.max(request.limit ?? 40, 1), 100);
    const spatialArea = (await this.spatialAreas?.administrativeArea(request.area)) ?? null;
    const center = spatialArea ? null : knownSeoulSearchArea(request.area);
    if (!spatialArea && !center) return [];
    const radiusMeters = request.radiusMeters ?? center?.radiusMeters ?? 1_000;
    const categories = [
      ...new Set(
        (request.interests ?? [])
          .map((interest) => INTEREST_CATEGORIES[interest.normalize('NFKC').toLowerCase()])
          .filter((category): category is string => category !== undefined),
      ),
    ];
    const query = this.places
      .createQueryBuilder('place')
      .where('place.source = :source', { source: KTO_PLACE_SOURCE })
      .andWhere('place.location IS NOT NULL')
      .andWhere(
        "NOT (place.name ILIKE '%DMZ%' OR place.name ILIKE '%판문점%' OR place.name ILIKE '%통일전망대%' OR place.name ILIKE '%제1땅굴%' OR place.name ILIKE '%제2땅굴%' OR place.name ILIKE '%제3땅굴%' OR place.name ILIKE '%제4땅굴%' OR place.name ILIKE '%도라산%' OR place.name ILIKE '%임진각%' OR place.name ILIKE '%탈북%' OR (place.name ILIKE '%북한%' AND place.name NOT ILIKE '%북한산%'))",
      );
    if (spatialArea) {
      query
        .innerJoin('seoul_spatial_areas', 'area', 'area.id = :areaId', {
          areaId: spatialArea.id,
        })
        .andWhere('ST_DWithin(place.location, area.geometry::geography, :radiusMeters)', {
          radiusMeters,
        })
        .addSelect(
          'CASE WHEN ST_Covers(area.geometry, place.location::geometry) THEN 0 ELSE 1 END',
          'inside_rank',
        )
        .addSelect('ST_Distance(place.location, area.geometry::geography)', 'distance_rank')
        .addOrderBy('inside_rank', 'ASC');
    } else if (center) {
      query
        .andWhere(
          `ST_DWithin(
            place.location,
            ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography,
            :radiusMeters
          )`,
          { longitude: center.longitude, latitude: center.latitude, radiusMeters },
        )
        .addSelect(
          `ST_Distance(
            place.location,
            ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography
          )`,
          'distance_rank',
        );
    }
    if (categories.length > 0) {
      query
        .addSelect(
          'CASE WHEN place.category IN (:...categories) THEN 0 ELSE 1 END',
          'category_rank',
        )
        .addOrderBy('category_rank', 'ASC')
        .setParameter('categories', categories);
    }
    const places = await query
      .addOrderBy('distance_rank', 'ASC')
      .addOrderBy('place.id', 'ASC')
      .take(limit)
      .getMany();
    return places.map((place) => {
      const price = verifiedPlacePrice(place.estimatedCostKrw, place.priceEvidence);
      place.estimatedCostKrw = price?.estimatedCostKrw ?? null;
      place.priceEvidence = price?.priceEvidence ?? null;
      return place;
    });
  }
}
