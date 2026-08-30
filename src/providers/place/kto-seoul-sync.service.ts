import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Place } from '../../database/entities';
import { KtoPlaceProvider } from './kto-place.provider';
import { PlaceNormalizer } from './place-normalizer';

export interface KtoSyncOptions {
  pageSize?: number;
  maxPages?: number;
}

export interface KtoSyncSummary {
  fetched: number;
  accepted: number;
  rejected: number;
  inserted: number;
  updated: number;
  pages: number;
  totalAvailable: number;
}

@Injectable()
export class KtoSeoulSyncService {
  constructor(
    @InjectRepository(Place) private readonly places: Repository<Place>,
    private readonly provider: KtoPlaceProvider,
    private readonly normalizer: PlaceNormalizer,
  ) {}

  async synchronize(options: KtoSyncOptions = {}): Promise<KtoSyncSummary> {
    const pageSize = options.pageSize ?? 100;
    const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
    if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > 1000) {
      throw new Error('KTO sync pageSize must be an integer between 1 and 1000');
    }
    if (maxPages !== Number.POSITIVE_INFINITY && (!Number.isInteger(maxPages) || maxPages <= 0)) {
      throw new Error('KTO sync maxPages must be a positive integer');
    }

    const summary: KtoSyncSummary = {
      fetched: 0,
      accepted: 0,
      rejected: 0,
      inserted: 0,
      updated: 0,
      pages: 0,
      totalAvailable: 0,
    };

    for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
      const page = await this.provider.fetchSeoulPage(pageNo, pageSize);
      summary.pages += 1;
      summary.totalAvailable = page.totalCount;
      summary.fetched += page.places.length + page.rejectedCount;
      summary.rejected += page.rejectedCount;

      const normalized = page.places.map((record) => this.normalizer.normalize(record));
      summary.accepted += normalized.length;
      if (normalized.length > 0) {
        const sourceIds = normalized.map((place) => place.sourcePlaceId);
        const existing = await this.places.find({
          select: { id: true, sourcePlaceId: true },
          where: { source: this.provider.name, sourcePlaceId: In(sourceIds) },
        });
        const existingBySourceId = new Map(
          existing.map((place) => [place.sourcePlaceId, place.id]),
        );
        const existingIds = new Set(existingBySourceId.keys());
        summary.updated += normalized.filter((place) =>
          existingIds.has(place.sourcePlaceId),
        ).length;
        summary.inserted += normalized.length - existingIds.size;
        await this.places.save(
          normalized.map((place) =>
            this.places.create({
              ...place,
              id: existingBySourceId.get(place.sourcePlaceId),
            }),
          ),
        );
      }

      const consumed = pageNo * page.numOfRows;
      if (page.places.length + page.rejectedCount === 0 || consumed >= page.totalCount) break;
    }
    return summary;
  }
}
