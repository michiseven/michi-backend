import { Type } from 'class-transformer';
import {
  IsIn,
  IsBoolean,
  IsObject,
  IsInt,
  IsOptional,
  IsArray,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ArrayUnique,
} from 'class-validator';
import { SAFETY_CONSTRAINT_KINDS, type SafetyConstraintKind } from '../../trips/safety-constraints';

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
  @IsIn(['total', 'per_person'])
  budgetScope?: 'total' | 'per_person';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  airport?: string;

  @IsOptional()
  @IsIn(['ICN_T1', 'ICN_T2', 'GMP_INTL', 'GMP_DOM'])
  arrivalAirport?: 'ICN_T1' | 'ICN_T2' | 'GMP_INTL' | 'GMP_DOM';

  @IsOptional()
  @IsIn(['ICN_T1', 'ICN_T2', 'GMP_INTL', 'GMP_DOM'])
  departureAirport?: 'ICN_T1' | 'ICN_T2' | 'GMP_INTL' | 'GMP_DOM';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  hotel?: string;

  /** A verified hotel selection from the client; free-form hotel remains in `hotel`. */
  @IsOptional()
  @IsObject()
  hotelSelection?: {
    name: string;
    roadAddress?: string | null;
    address?: string | null;
    category?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    source?: string;
    sourcePlaceId?: string;
  };

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  partySize?: number;

  @IsOptional()
  @IsIn(['solo', 'couple', 'friends', 'family', 'with_children'])
  companions?: 'solo' | 'couple' | 'friends' | 'family' | 'with_children';

  @IsOptional()
  @IsIn(['relaxed', 'standard', 'packed'])
  pace?: 'relaxed' | 'standard' | 'packed';

  @IsOptional()
  @IsBoolean()
  hasLuggage?: boolean;

  /** Explicit safety requirements supplement, but never replace, the user's text. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(SAFETY_CONSTRAINT_KINDS, { each: true })
  safetyConstraints?: SafetyConstraintKind[];

  @IsOptional()
  @IsString()
  @IsIn(['ja', 'ko'])
  locale?: 'ja' | 'ko';
}
