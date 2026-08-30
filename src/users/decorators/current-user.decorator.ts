import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { User } from '../../database/entities';

/** 인증된 요청에서 User 엔티티를 꺼내는 파라미터 데코레이터 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User => {
  const request = ctx.switchToHttp().getRequest<{ user?: User }>();
  if (!request.user) {
    throw new UnauthorizedException('로그인이 필요합니다.');
  }
  return request.user;
});
