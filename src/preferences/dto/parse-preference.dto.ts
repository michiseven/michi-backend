import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ParsePreferenceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  startArea?: string;

  @IsOptional()
  @Matches(TIME_PATTERN)
  startTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN)
  endTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  budget?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  airport?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  hotel?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ja', 'ko'])
  locale?: 'ja' | 'ko';
}
