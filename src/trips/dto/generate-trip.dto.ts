import { IsArray, IsDateString, IsIn, IsOptional, Matches } from 'class-validator';
import { ParsePreferenceDto } from '../../preferences/dto/parse-preference.dto';
import { TRIP_RELAXATIONS, type TripRelaxation } from '../trip-generation-recovery';

export class GenerateTripDto extends ParsePreferenceDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  travelDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  endDate?: string;

  /** A user-selected recovery choice from a prior failed generation request. */
  @IsOptional()
  @IsArray()
  @IsIn(TRIP_RELAXATIONS, { each: true })
  relaxations?: TripRelaxation[];
}
