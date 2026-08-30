import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(2, 100)
  @Transform(({ value }: { value: unknown }): string =>
    typeof value === 'string' ? value.trim() : '',
  )
  displayName!: string;

  @IsEmail()
  @Transform(({ value }: { value: unknown }): string =>
    typeof value === 'string' ? value.trim().toLowerCase() : '',
  )
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsIn(['ja', 'ko'])
  locale?: 'ja' | 'ko';
}

export class LoginDto {
  @IsEmail()
  @Transform(({ value }: { value: unknown }): string =>
    typeof value === 'string' ? value.trim().toLowerCase() : '',
  )
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  @Transform(({ value }: { value: unknown }): string =>
    typeof value === 'string' ? value.trim() : '',
  )
  displayName?: string;

  @IsOptional()
  @IsIn(['ja', 'ko'])
  locale?: 'ja' | 'ko';
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class WithdrawDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class SaveTripDto {
  @IsUUID()
  tripId!: string;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  travelDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  stopsCount?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  estimatedTotalCost?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsObject()
  tripSnapshot?: Record<string, unknown>;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(2000)
  memo?: string | null;
}

export class UpdateMemoDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(2000)
  memo!: string | null;
}

export class GetSavedTripsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
