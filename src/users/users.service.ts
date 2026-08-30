import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { RefreshToken, User, UserSavedTrip } from '../database/entities';
import type {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  SaveTripDto,
  UpdateProfileDto,
} from './dto/users.dto';
import { hashPassword, signJwt, verifyPassword } from './utils/crypto-auth.util';
import { LogEvent, LogField } from '@logfriends/sdk';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserProfile {
  id: string;
  displayName: string;
  email: string;
  locale: string;
  createdAt: Date;
}

const ACCESS_TOKEN_EXPIRES_IN = 60 * 60; // 1 hour (seconds)
const REFRESH_TOKEN_EXPIRES_IN = 60 * 60 * 24 * 30; // 30 days (seconds)

function toProfile(user: User): UserProfile {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    locale: user.locale,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(UserSavedTrip)
    private readonly savedTripsRepo: Repository<UserSavedTrip>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokensRepo: Repository<RefreshToken>,
  ) {}

  // ─── Auth helpers ─────────────────────────────────────────────────────────

  private getAccessSecret(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  private issueAccessToken(user: User): string {
    return signJwt(
      { sub: user.id, email: user.email, type: 'access' },
      this.getAccessSecret(),
      ACCESS_TOKEN_EXPIRES_IN,
    );
  }

  private async issueRefreshToken(user: User): Promise<string> {
    const rawToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN * 1000);

    const record = this.refreshTokensRepo.create({
      userId: user.id,
      tokenHash,
      expiresAt,
    });
    await this.refreshTokensRepo.save(record);

    return rawToken;
  }

  private async buildTokenPair(user: User): Promise<TokenPair> {
    const accessToken = this.issueAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user);
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_EXPIRES_IN };
  }

  // ─── Public methods ────────────────────────────────────────────────────────

  /**
   * 회원가입
   */
  @LogEvent({
    name: 'userRegistered',
    description: '신규 사용자 회원가입',
    includeResult: false,
    includeArgs: false,
    fields: [{ name: 'locale', description: '선택한 서비스 언어', type: 'string' }],
    payload: (args) => ({ locale: (args[0] as RegisterDto)?.locale ?? 'ja' }),
  })
  async register(
    @LogField({ name: 'dto', description: '회원가입 정보' })
    dto: RegisterDto,
  ): Promise<{ user: UserProfile; tokens: TokenPair }> {
    const normalizedEmail = dto.email.toLowerCase().trim();
    const existing = await this.usersRepo.findOne({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException('이미 사용 중인 이메일입니다.');
    }

    const passwordHash = await hashPassword(dto.password);
    const user = this.usersRepo.create({
      displayName: dto.displayName.trim(),
      email: normalizedEmail,
      passwordHash,
      locale: dto.locale ?? 'ja',
    });
    await this.usersRepo.save(user);

    const tokens = await this.buildTokenPair(user);
    return { user: toProfile(user), tokens };
  }

  /**
   * 로그인
   */
  @LogEvent({
    name: 'userLoggedIn',
    description: '사용자 계정 로그인',
    includeResult: false,
    includeArgs: false,
    fields: [],
    payload: () => ({}),
  })
  async login(
    @LogField({ name: 'dto', description: '로그인 인증 정보' })
    dto: LoginDto,
  ): Promise<{ user: UserProfile; tokens: TokenPair }> {
    const normalizedEmail = dto.email.toLowerCase().trim();
    const user = await this.usersRepo.findOne({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const isPasswordValid = await verifyPassword(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const tokens = await this.buildTokenPair(user);
    return { user: toProfile(user), tokens };
  }

  /**
   * Refresh Token으로 새 토큰 쌍 발급 (Rotation)
   */
  async refreshTokens(rawRefreshToken: string): Promise<{ user: UserProfile; tokens: TokenPair }> {
    if (!rawRefreshToken || !rawRefreshToken.trim()) {
      throw new UnauthorizedException('리프레시 토큰이 없습니다.');
    }
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken.trim()).digest('hex');

    const record = await this.refreshTokensRepo.findOne({
      where: { tokenHash },
      relations: ['user'],
    });

    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('유효하지 않거나 만료된 리프레시 토큰입니다.');
    }

    if (!record.user.isActive) {
      throw new UnauthorizedException('비활성화된 계정입니다.');
    }

    // 조건부 단일 UPDATE로 기존 토큰을 선점해 동시 재사용을 차단한다.
    // 조회 이후 다른 요청이 먼저 폐기했다면 affected=0이므로 새 토큰을 발급하지 않는다.
    const now = new Date();
    const revokeResult = await this.refreshTokensRepo
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: now })
      .where('id = :id', { id: record.id })
      .andWhere('revoked_at IS NULL')
      .andWhere('expires_at > :now', { now })
      .execute();

    if (revokeResult.affected !== 1) {
      throw new UnauthorizedException('이미 사용되었거나 만료된 리프레시 토큰입니다.');
    }

    const tokens = await this.buildTokenPair(record.user);
    return { user: toProfile(record.user), tokens };
  }

  /**
   * 로그아웃 (Refresh Token 폐기)
   */
  async logout(rawRefreshToken: string): Promise<void> {
    if (!rawRefreshToken || !rawRefreshToken.trim()) return;
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken.trim()).digest('hex');
    await this.refreshTokensRepo.update({ tokenHash }, { revokedAt: new Date() });
  }

  /**
   * 모든 기기에서 로그아웃 (해당 사용자의 모든 Refresh Token 폐기)
   */
  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokensRepo
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date() })
      .where('user_id = :userId AND revoked_at IS NULL', { userId })
      .execute();
  }

  /**
   * 내 프로필 조회
   */
  getProfile(user: User): UserProfile {
    return toProfile(user);
  }

  /**
   * 프로필 수정
   */
  async updateProfile(user: User, dto: UpdateProfileDto): Promise<UserProfile> {
    if (dto.displayName !== undefined) {
      user.displayName = dto.displayName.trim();
    }
    if (dto.locale !== undefined) {
      user.locale = dto.locale;
    }
    await this.usersRepo.save(user);
    return toProfile(user);
  }

  /**
   * 비밀번호 변경
   */
  async changePassword(user: User, dto: ChangePasswordDto): Promise<void> {
    const isValid = await verifyPassword(dto.currentPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestException('현재 비밀번호가 올바르지 않습니다.');
    }
    user.passwordHash = await hashPassword(dto.newPassword);
    await this.usersRepo.save(user);
    await this.logoutAll(user.id);
  }

  /**
   * 회원 탈퇴 (소프트 삭제)
   */
  async withdraw(user: User, password: string): Promise<void> {
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('비밀번호가 올바르지 않습니다.');
    }
    await this.logoutAll(user.id);
    user.isActive = false;
    await this.usersRepo.save(user);
  }

  // ─── 저장된 일정 관리 ────────────────────────────────────────────────────

  /**
   * 일정 저장 (스냅샷)
   */
  @LogEvent({
    name: 'userSavedTrip',
    description: '사용자 여행 일정 보관함 저장',
    includeResult: false,
    includeArgs: false,
    fields: [
      { name: 'tripId', description: '저장한 여행 식별자', type: 'string' },
      { name: 'stopsCount', description: '저장한 경유지 수', type: 'number', required: false },
      { name: 'hasMemo', description: '메모 존재 여부', type: 'boolean' },
      { name: 'hasSnapshot', description: '일정 스냅샷 존재 여부', type: 'boolean' },
    ],
    payload: (args) => {
      const dto = args[1] as SaveTripDto;
      return {
        tripId: dto?.tripId,
        stopsCount: dto?.stopsCount,
        hasMemo: Boolean(dto?.memo),
        hasSnapshot: Boolean(dto?.tripSnapshot),
      };
    },
  })
  async saveTrip(
    user: User,
    @LogField({ name: 'dto', description: '저장할 여행 일정 정보' })
    dto: SaveTripDto,
  ): Promise<UserSavedTrip> {
    const existing = await this.savedTripsRepo.findOne({
      where: { userId: user.id, tripId: dto.tripId },
    });

    if (existing) {
      existing.title = dto.title ?? existing.title;
      existing.travelDate = dto.travelDate ?? existing.travelDate;
      existing.stopsCount = dto.stopsCount ?? existing.stopsCount;
      existing.estimatedTotalCost = dto.estimatedTotalCost ?? existing.estimatedTotalCost;
      if (dto.tripSnapshot !== undefined) existing.tripSnapshot = dto.tripSnapshot;
      if (dto.memo !== undefined) existing.memo = dto.memo;
      return this.savedTripsRepo.save(existing);
    }

    const record = this.savedTripsRepo.create({
      userId: user.id,
      tripId: dto.tripId,
      title: dto.title ?? '',
      travelDate: dto.travelDate ?? '',
      stopsCount: dto.stopsCount ?? 0,
      estimatedTotalCost: dto.estimatedTotalCost ?? null,
      tripSnapshot: dto.tripSnapshot ?? null,
      memo: dto.memo ?? null,
    });
    return this.savedTripsRepo.save(record);
  }

  /**
   * 저장된 일정 목록 (최신순)
   */
  async getSavedTrips(
    user: User,
    page = 1,
    limit = 20,
  ): Promise<{ items: UserSavedTrip[]; total: number; page: number; limit: number }> {
    const [items, total] = await this.savedTripsRepo.findAndCount({
      where: { userId: user.id },
      order: { savedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }

  /**
   * 저장된 일정 단건 조회
   */
  async getSavedTrip(user: User, savedId: string): Promise<UserSavedTrip> {
    const record = await this.savedTripsRepo.findOne({
      where: { id: savedId, userId: user.id },
    });
    if (!record) {
      throw new NotFoundException('저장된 일정을 찾을 수 없습니다.');
    }
    return record;
  }

  /**
   * 메모 업데이트
   */
  async updateSavedTripMemo(
    user: User,
    savedId: string,
    memo: string | null,
  ): Promise<UserSavedTrip> {
    const record = await this.getSavedTrip(user, savedId);
    record.memo = memo;
    return this.savedTripsRepo.save(record);
  }

  /**
   * 저장된 일정 삭제
   */
  async removeSavedTrip(user: User, savedId: string): Promise<void> {
    const record = await this.getSavedTrip(user, savedId);
    await this.savedTripsRepo.remove(record);
  }
}
