import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ResumeThreadDto {
  @IsNotEmpty()
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  chosenPlaceId?: string;

  @IsOptional()
  @IsString()
  threadSecret?: string;

  @IsOptional()
  @IsString()
  editToken?: string;
}
