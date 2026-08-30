import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

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
    hotel?: { name: string; address?: string } | null;
    partySize?: string;
    hasLuggage?: boolean;
    arrivalDate?: string;
    arrivalTime?: string;
    departureDate?: string;
    departureTime?: string;
  } | null;
}
