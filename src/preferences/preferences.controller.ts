import { Body, Controller, Post } from '@nestjs/common';
import { ParsePreferenceDto } from './dto/parse-preference.dto';
import type { PreferenceParseResult } from './preference.types';
import { PreferencesService } from './preferences.service';

@Controller('preferences')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Post('parse')
  parse(@Body() dto: ParsePreferenceDto): Promise<PreferenceParseResult> {
    return this.preferences.parse(dto);
  }
}
