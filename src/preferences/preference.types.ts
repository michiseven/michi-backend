export type CompanionType = 'solo' | 'couple' | 'friends' | 'family' | 'other';
export type TravelPace = 'relaxed' | 'balanced' | 'packed';
export type UserPriority =
  'crowd_avoidance' | 'must_visit' | 'short_transit' | 'interest' | 'budget';

export interface AnchorPlacePreference {
  name: string;
  targetTime?: string | null;
  role?: 'start' | 'intermediate' | 'destination' | null;
}

export interface FixedAppointmentPreference {
  name: string;
  targetTime: string;
  durationMinutes: number;
  isMandatory: boolean;
  category?: string | null;
}

export interface MealWindowPreference {
  mealType: 'lunch' | 'dinner';
  targetTime: string;
  durationMinutes: number;
  cuisinePreferences?: string[];
  area?: string | null;
}

export interface BaseCampHotelPreference {
  name: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  dailyReturnTime?: string | null;
}

export interface MobilityConstraintPreference {
  maxWalkMinutesPerLeg: number;
  avoidSteepInclineOrStairs: boolean;
  preferredTransit?: 'subway' | 'bus' | 'walk' | 'taxi' | null;
}

export interface DayTripPreference {
  dayNumber: number;
  date?: string | null;
  title?: string | null;
  area: string | null;
  startTime: string;
  endTime: string;
  dailyBudgetKrw?: number | null;
  startAnchor?: AnchorPlacePreference | null;
  endAnchor?: AnchorPlacePreference | null;
  fixedAppointments?: FixedAppointmentPreference[];
  mealWindows?: MealWindowPreference[];
  mustVisitPlaces?: string[];
  interests: string[];
  preferences: string[];
  avoid: string[];
  maxWalkMinutes?: number | null;
  anchorPlace?: AnchorPlacePreference | null;
}

export interface ParsedTripPreference {
  tripTitle?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  totalDays?: number | null;
  totalBudgetKrw?: number | null;
  partySize?: number | null;
  companions: CompanionType | null;
  pace: TravelPace | null;
  baseCamp?: BaseCampHotelPreference | null;
  airport?: string | null;
  mobilityConstraint?: MobilityConstraintPreference | null;
  userPriorities?: UserPriority[];
  rainFallbackPolicy?: 'indoor_switch' | 'keep' | null;

  // Single-day backward compatibility shortcuts
  area: string | null;
  startTime: string;
  endTime: string;
  budget: number | null;
  interests: string[];
  preferences: string[];
  avoid: string[];
  maxWalkMinutes?: number | null;
  anchorPlace?: AnchorPlacePreference | null;

  // Hierarchical multi-day specification
  days?: DayTripPreference[];
}

export interface PreferenceParseInput {
  text: string;
  startArea?: string;
  startTime?: string;
  endTime?: string;
  budget?: number;
  startDate?: string;
  endDate?: string;
  travelDate?: string;
  airport?: string;
  hotel?: string;
  locale?: 'ja' | 'ko';
}

export interface PreferenceParseResult {
  preference: ParsedTripPreference;
  parserMode: 'mock' | 'live';
  warnings: string[];
}
