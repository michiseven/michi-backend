import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import type { SafetyConstraintKind } from '../../trips/safety-constraints';
import { TRIP_RELAXATIONS, type TripRelaxation } from '../../trips/trip-generation-recovery';

export class SendMessageDto {
  @IsNotEmpty()
  @IsString()
  message!: string;

  @IsOptional()
  @IsIn(['ko', 'ja'])
  locale?: 'ko' | 'ja';

  @IsOptional()
  @IsString()
  currentTripId?: string;

  @IsOptional()
  @IsString()
  threadSecret?: string;

  @IsOptional()
  @IsString()
  editToken?: string;

  @IsOptional()
  @IsObject()
  profile?: {
    arrivalAirport?: 'ICN_T1' | 'ICN_T2' | 'GMP_INTL' | 'GMP_DOM';
    departureAirport?: 'ICN_T1' | 'ICN_T2' | 'GMP_INTL' | 'GMP_DOM';
    hotel?: { name: string; address?: string } | null;
    partySize?: number;
    budget?: number;
    budgetScope?: 'total' | 'per_person';
    companions?: 'solo' | 'couple' | 'friends' | 'family' | 'with_children';
    pace?: 'relaxed' | 'standard' | 'packed';
    safetyConstraints?: SafetyConstraintKind[];
    hasLuggage?: boolean;
    arrivalDate?: string;
    arrivalTime?: string;
    departureDate?: string;
    departureTime?: string;
  } | null;

  /** A selected example starts a new plan instead of continuing a prior trip. */
  @IsOptional()
  @IsBoolean()
  startFreshTrip?: boolean;

  /** Whether the supplied profile is intentionally applied to this request. */
  @IsOptional()
  @IsIn(['apply', 'ignore'])
  profilePolicy?: 'apply' | 'ignore';

  /** A recovery choice selected by the user after a failed generation attempt. */
  @IsOptional()
  @IsArray()
  @IsIn(TRIP_RELAXATIONS, { each: true })
  relaxations?: TripRelaxation[];
}
