import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  PlaceDetailEvidencePayload,
  PlaceDetailEvidenceStatus,
} from '../../place-details/place-detail-evidence.types';
import { Place } from './place.entity';

@Entity({ name: 'place_detail_evidences' })
@Index('idx_place_detail_evidences_place_expires', ['placeId', 'expiresAt'])
export class PlaceDetailEvidence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId!: string;

  @ManyToOne(() => Place, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'place_id' })
  place!: Place;

  @Column({ type: 'varchar', length: 60 })
  provider!: 'openai-web-search';

  @Column({ type: 'varchar', length: 120 })
  model!: string;

  @Column({ name: 'response_id', type: 'varchar', length: 255, nullable: true })
  responseId!: string | null;

  @Column({ type: 'varchar', length: 30 })
  status!: PlaceDetailEvidenceStatus;

  @Column({ type: 'jsonb' })
  evidence!: PlaceDetailEvidencePayload;

  @CreateDateColumn({ name: 'fetched_at', type: 'timestamptz' })
  fetchedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
