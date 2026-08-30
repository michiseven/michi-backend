import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { User, UserSavedTrip } from '../database/entities';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  ChangePasswordDto,
  GetSavedTripsQueryDto,
  LoginDto,
  RegisterDto,
  SaveTripDto,
  UpdateMemoDto,
  UpdateProfileDto,
  WithdrawDto,
} from './dto/users.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UsersService, type UserProfile } from './users.service';

export interface AuthResponse {
  user: UserProfile;
  accessToken: string;
  expiresIn: number;
}

export interface PaginatedSavedTrips {
  items: UserSavedTrip[];
  total: number;
  page: number;
  limit: number;
}

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers?.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match && match[1] ? decodeURIComponent(match[1]) : null;
}

@Controller()
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  private setRefreshCookie(res: Response, token: string): void {
    if (!res || typeof res.cookie !== 'function') return;
    const isSecure =
      this.config.get<boolean>('AUTH_COOKIE_SECURE') ?? process.env.NODE_ENV === 'production';
    const sameSite = (this.config.get<string>('AUTH_COOKIE_SAME_SITE') ?? 'lax') as
      'lax' | 'strict' | 'none';
    const path = this.config.get<string>('AUTH_COOKIE_PATH') ?? '/api/auth';

    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isSecure,
      sameSite,
      path,
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }

  private clearRefreshCookie(res: Response): void {
    if (!res || typeof res.clearCookie !== 'function') return;
    const isSecure =
      this.config.get<boolean>('AUTH_COOKIE_SECURE') ?? process.env.NODE_ENV === 'production';
    const sameSite = (this.config.get<string>('AUTH_COOKIE_SAME_SITE') ?? 'lax') as
      'lax' | 'strict' | 'none';
    const path = this.config.get<string>('AUTH_COOKIE_PATH') ?? '/api/auth';

    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: isSecure,
      sameSite,
      path,
    });
  }

  // ─── 인증 엔드포인트 ────────────────────────────────────────────────────

  /**
   * POST /auth/register
   * 회원가입
   */
  @Post('auth/register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.usersService.register(dto);
    this.setRefreshCookie(res, result.tokens.refreshToken);
    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
    };
  }

  /**
   * POST /auth/login
   * 로그인
   */
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.usersService.login(dto);
    this.setRefreshCookie(res, result.tokens.refreshToken);
    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
    };
  }

  /**
   * POST /auth/refresh
   * Refresh Token으로 새 Access Token 발급 (Rotation)
   */
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const rawToken = getCookie(req, REFRESH_COOKIE_NAME) ?? '';
    const result = await this.usersService.refreshTokens(rawToken);
    this.setRefreshCookie(res, result.tokens.refreshToken);
    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
    };
  }

  /**
   * POST /auth/logout
   * 로그아웃 (현재 세션)
   */
  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const rawToken = getCookie(req, REFRESH_COOKIE_NAME) ?? '';
    await this.usersService.logout(rawToken);
    this.clearRefreshCookie(res);
  }

  /**
   * POST /auth/logout-all
   * 모든 기기에서 로그아웃
   */
  @Post('auth/logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.usersService.logoutAll(user.id);
    this.clearRefreshCookie(res);
  }

  // ─── 사용자 프로필 엔드포인트 ───────────────────────────────────────────

  /**
   * GET /users/me
   * 내 프로필 조회
   */
  @Get('users/me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: User): UserProfile {
    return this.usersService.getProfile(user);
  }

  /**
   * PATCH /users/me
   * 프로필 수정
   */
  @Patch('users/me')
  @UseGuards(JwtAuthGuard)
  async updateMe(@CurrentUser() user: User, @Body() dto: UpdateProfileDto): Promise<UserProfile> {
    return this.usersService.updateProfile(user, dto);
  }

  /**
   * POST /users/me/change-password
   * 비밀번호 변경 (모든 세션 무효화)
   */
  @Post('users/me/change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.usersService.changePassword(user, dto);
    this.clearRefreshCookie(res);
  }

  /**
   * DELETE /users/me
   * 회원 탈퇴 (비밀번호 검증 및 소프트 삭제)
   */
  @Delete('users/me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async withdraw(
    @CurrentUser() user: User,
    @Body() dto: WithdrawDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.usersService.withdraw(user, dto.password);
    this.clearRefreshCookie(res);
  }

  // ─── 저장된 일정 엔드포인트 ─────────────────────────────────────────────

  /**
   * POST /users/me/saved-trips
   * 일정 저장 (스냅샷)
   */
  @Post('users/me/saved-trips')
  @UseGuards(JwtAuthGuard)
  async saveTrip(@CurrentUser() user: User, @Body() dto: SaveTripDto): Promise<UserSavedTrip> {
    return this.usersService.saveTrip(user, dto);
  }

  /**
   * GET /users/me/saved-trips
   * 저장된 일정 목록
   */
  @Get('users/me/saved-trips')
  @UseGuards(JwtAuthGuard)
  async getSavedTrips(
    @CurrentUser() user: User,
    @Query() query: GetSavedTripsQueryDto,
  ): Promise<PaginatedSavedTrips> {
    return this.usersService.getSavedTrips(user, query.page ?? 1, query.limit ?? 20);
  }

  /**
   * GET /users/me/saved-trips/:savedId
   * 저장된 일정 단건 조회 (스냅샷 포함)
   */
  @Get('users/me/saved-trips/:savedId')
  @UseGuards(JwtAuthGuard)
  async getSavedTrip(
    @CurrentUser() user: User,
    @Param('savedId', new ParseUUIDPipe({ version: '4' })) savedId: string,
  ): Promise<UserSavedTrip> {
    return this.usersService.getSavedTrip(user, savedId);
  }

  /**
   * PATCH /users/me/saved-trips/:savedId/memo
   * 메모 수정
   */
  @Patch('users/me/saved-trips/:savedId/memo')
  @UseGuards(JwtAuthGuard)
  async updateMemo(
    @CurrentUser() user: User,
    @Param('savedId', new ParseUUIDPipe({ version: '4' })) savedId: string,
    @Body() dto: UpdateMemoDto,
  ): Promise<UserSavedTrip> {
    return this.usersService.updateSavedTripMemo(user, savedId, dto.memo);
  }

  /**
   * DELETE /users/me/saved-trips/:savedId
   * 저장된 일정 삭제
   */
  @Delete('users/me/saved-trips/:savedId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSavedTrip(
    @CurrentUser() user: User,
    @Param('savedId', new ParseUUIDPipe({ version: '4' })) savedId: string,
  ): Promise<void> {
    await this.usersService.removeSavedTrip(user, savedId);
  }
}
