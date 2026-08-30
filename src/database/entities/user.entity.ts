import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserSavedTrip } from './user-saved-trip.entity';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 일본어 사용자 기준 닉네임/표시명 */
  @Column({ name: 'display_name', type: 'varchar', length: 100 })
  displayName!: string;

  /** 로그인용 이메일 (소문자 저장) */
  @Column({ name: 'email', type: 'varchar', length: 255, unique: true })
  email!: string;

  /** bcrypt 해시된 비밀번호 */
  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  /** UI 언어 기본값: ja(일본어) 또는 ko(한국어) */
  @Column({ name: 'locale', type: 'varchar', length: 8, default: 'ja' })
  locale!: string;

  /** 계정 활성화 여부 */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => UserSavedTrip, (saved) => saved.user, { cascade: true })
  savedTrips!: UserSavedTrip[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
