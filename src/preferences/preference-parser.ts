import type { PreferenceParseInput, PreferenceParseResult } from './preference.types';

export const TRIP_PREFERENCE_PARSER = Symbol('TRIP_PREFERENCE_PARSER');

export interface TripPreferenceParser {
  parse(input: PreferenceParseInput): Promise<PreferenceParseResult>;
}
