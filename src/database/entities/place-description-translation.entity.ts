import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Place } from './place.entity';

export type PlaceDescriptionLocale = 'ko' | 'ja';

export interface PlaceDescriptionSource {
  title: string;
  url: string;
}

/**
 * NAVER Local Search가 식별한 장소에 대해, 웹 검색 출처를 바탕으로 만든 짧은 소개의
 * 언어별 캐시다. 추천 점수/경로의 입력이 아니며 원본 Provider payload를 덮어쓰지 않는다.
 */
@Entity({ name: 'place_description_translations' })
@Unique('uq_place_description_translations_place_locale', ['placeId', 'locale'])
@Index('idx_place_description_translations_place_id', ['placeId'])
export class PlaceDescriptionTranslation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId!: string;

  @ManyToOne(() => Place, (place) => place.descriptionTranslations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'place_id' })
  place!: Place;

  @Column({ type: 'varchar', length: 2 })
  locale!: PlaceDescriptionLocale;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 60 })
  provider!: 'openai-web-search';

  @Column({ type: 'varchar', length: 120 })
  model!: string;

  @Column({ name: 'response_id', type: 'varchar', length: 255, nullable: true })
  responseId!: string | null;

  @Column({ name: 'sources', type: 'jsonb' })
  sources!: PlaceDescriptionSource[];

  @CreateDateColumn({ name: 'fetched_at', type: 'timestamptz' })
  fetchedAt!: Date;
}
