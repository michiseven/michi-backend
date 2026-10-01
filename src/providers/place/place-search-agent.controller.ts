import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import {
  PlaceSearchAgentService,
  type PlaceSearchAgentPublicResult,
} from './place-search-agent.service';

export class PlaceSearchAgentDto {
  @IsString() @MinLength(1) @MaxLength(80) area!: string;
  @IsString() @MinLength(1) @MaxLength(120) query!: string;
  @IsIn(['cafe', 'restaurant', 'stroll', 'park', 'shopping', 'culture', 'attraction'])
  role!: string;
  @IsOptional() @IsIn(['ko', 'ja']) locale?: 'ko' | 'ja';
}

@Controller('places')
export class PlaceSearchAgentController {
  constructor(private readonly agent: PlaceSearchAgentService) {}
  @Post('agent-search')
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  search(@Body() dto: PlaceSearchAgentDto): Promise<PlaceSearchAgentPublicResult> {
    return this.agent.search(
      { area: dto.area, query: dto.query, role: dto.role, limit: 10 },
      dto.locale,
    );
  }
}
