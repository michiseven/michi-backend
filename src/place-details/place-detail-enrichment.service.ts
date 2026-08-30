import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { PlaceDetailEvidence } from '../database/entities';
import type {
  PlaceDetailEnrichmentGateway,
  PlaceDetailEvidenceView,
  PlaceDetailSearchInput,
} from './place-detail-evidence.types';
import { OpenAIPlaceDetailSearchProvider } from './openai-place-detail-search.provider';

@Injectable()
export class PlaceDetailEnrichmentService implements PlaceDetailEnrichmentGateway {
  private readonly logger = new Logger(PlaceDetailEnrichmentService.name);

  constructor(
    @InjectRepository(PlaceDetailEvidence)
    private readonly evidenceRepo: Repository<PlaceDetailEvidence>,
    private readonly provider: OpenAIPlaceDetailSearchProvider,
    private readonly config: ConfigService,
  ) {}

  async enrich(input: PlaceDetailSearchInput): Promise<PlaceDetailEvidenceView | null> {
    if (!this.config.get<boolean>('PLACE_DETAIL_WEB_SEARCH_ENABLED')) return null;

    const cached = await this.evidenceRepo.findOne({
      where: { placeId: input.placeId, expiresAt: MoreThan(new Date()) },
      order: { fetchedAt: 'DESC' },
    });
    if (cached) return this.toView(cached, true);

    try {
      const result = await this.provider.search(input);
      if (!result) return null;

      const ttlSeconds = this.config.get<number>('PLACE_DETAIL_WEB_CACHE_TTL_SECONDS') ?? 86_400;
      const saved = await this.evidenceRepo.save(
        this.evidenceRepo.create({
          placeId: input.placeId,
          provider: result.provider,
          model: result.model,
          responseId: result.responseId,
          status: result.status,
          evidence: result.evidence,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        }),
      );
      return this.toView(saved, false);
    } catch (error: unknown) {
      this.logger.warn(
        `Could not persist place detail evidence: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }

  private toView(entity: PlaceDetailEvidence, cacheHit: boolean): PlaceDetailEvidenceView {
    return {
      provider: entity.provider,
      model: entity.model,
      status: entity.status,
      evidence: entity.evidence,
      fetchedAt: entity.fetchedAt.toISOString(),
      expiresAt: entity.expiresAt.toISOString(),
      cacheHit,
    };
  }
}
