import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities';
import { verifyJwt, type JwtTokenPayload } from '../utils/crypto-auth.util';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: User;
    }>();

    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('인증 토큰이 없습니다.');
    }

    const token = authHeader.slice(7).trim();
    const secret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');

    let payload: JwtTokenPayload;
    try {
      payload = verifyJwt(token, secret);
    } catch {
      throw new UnauthorizedException('유효하지 않거나 만료된 토큰입니다.');
    }

    if (payload.type !== 'access') {
      throw new UnauthorizedException('올바르지 않은 토큰 유형입니다.');
    }

    const user = await this.usersRepo.findOne({
      where: { id: payload.sub, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없거나 비활성화된 계정입니다.');
    }

    request.user = user;
    return true;
  }
}
