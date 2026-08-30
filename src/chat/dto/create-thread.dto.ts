import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateThreadDto {
  @IsOptional()
  @IsIn(['ko', 'ja'])
  locale?: 'ko' | 'ja';

  @IsOptional()
  @IsString()
  currentTripId?: string;
}
