import { Body, Controller, Get, Post } from '@nestjs/common';
import { GenerateTripDto } from '../trips/dto/generate-trip.dto';
import { EvaluationService, type EvaluationResponseDto } from './evaluation.service';
import { EVALUATION_SCENARIOS, type EvaluationScenario } from './evaluation-scenarios';

@Controller('evaluations')
export class EvaluationController {
  constructor(private readonly evaluations: EvaluationService) {}

  @Get('scenarios')
  scenarios(): readonly EvaluationScenario[] {
    return EVALUATION_SCENARIOS;
  }

  @Post('compare')
  compare(@Body() dto: GenerateTripDto): Promise<EvaluationResponseDto> {
    return this.evaluations.compare(dto);
  }
}
