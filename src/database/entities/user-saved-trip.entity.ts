import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * 회원이 저장한 여행 일정 스냅샷.
 * Trip 레코드가 삭제되어도 스냅샷은 유지됩니다.
 */
@Entity({ name: 'user_saved_trips' })
export class UserSavedTrip {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, (user) => user.savedTrips, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** 원본 trip UUID (trips 테이블 FK 아님 — 삭제돼도 기록 유지) */
  @Column({ name: 'trip_id', type: 'uuid' })
  tripId!: string;

  /** 표시 제목 (생성 당시 title 복사) */
  @Column({ name: 'title', type: 'varchar', length: 255, default: '' })
  title!: string;

  /** 여행 날짜 문자열 (YYYY-MM-DD 또는 YYYY-MM-DD~YYYY-MM-DD) */
  @Column({ name: 'travel_date', type: 'varchar', length: 40, default: '' })
  travelDate!: string;

  /** 경유지 수 */
  @Column({ name: 'stops_count', type: 'integer', default: 0 })
  stopsCount!: number;

  /** 총 예상 비용 (KRW 정수, nullable) */
  @Column({ name: 'estimated_total_cost', type: 'integer', nullable: true })
  estimatedTotalCost!: number | null;

  /** 일정 전체 JSON 스냅샷 */
  @Column({ name: 'trip_snapshot', type: 'jsonb', nullable: true })
  tripSnapshot!: Record<string, unknown> | null;

  /** 사용자 메모 */
  @Column({ name: 'memo', type: 'text', nullable: true })
  memo!: string | null;

  @CreateDateColumn({ name: 'saved_at', type: 'timestamptz' })
  savedAt!: Date;
}
