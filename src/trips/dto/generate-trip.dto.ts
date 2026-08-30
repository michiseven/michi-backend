import { IsDateString, IsOptional, Matches } from 'class-validator';
import { ParsePreferenceDto } from '../../preferences/dto/parse-preference.dto';

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
}
