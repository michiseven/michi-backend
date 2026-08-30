import { IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';

export class PatchTripStopsDto {
  @IsIn(['remove', 'reorder', 'recalculate', 'replace'])
  action!: 'remove' | 'reorder' | 'recalculate' | 'replace';

  @IsOptional()
  @IsUUID()
  stopId?: string;

  @IsOptional()
  @IsUUID()
  newPlaceId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  stopIds?: string[];
}
