import { z } from 'zod';

const CompanionSchema = z.enum(['solo', 'couple', 'friends', 'family', 'other']);
const PaceSchema = z.enum(['relaxed', 'balanced', 'packed']);
const UserPrioritySchema = z.enum([
  'crowd_avoidance',
  'must_visit',
  'short_transit',
  'interest',
  'budget',
]);

const AnchorPlaceOutputSchema = z.object({
  name: z.string(),
  targetTime: z.string().nullable(),
  role: z.enum(['start', 'intermediate', 'destination']).nullable(),
});

const FixedAppointmentOutputSchema = z.object({
  name: z.string(),
  targetTime: z.string(),
  durationMinutes: z.number().int().min(1).max(600),
  isMandatory: z.boolean(),
  category: z.string().nullable(),
});

const MealWindowOutputSchema = z.object({
  mealType: z.enum(['lunch', 'dinner']),
  targetTime: z.string(),
  durationMinutes: z.number().int().min(1).max(300),
  cuisinePreferences: z.array(z.string()),
  area: z.string().nullable(),
});

const BaseCampOutputSchema = z.object({
  name: z.string(),
  checkInTime: z.string().nullable(),
  checkOutTime: z.string().nullable(),
  dailyReturnTime: z.string().nullable(),
});

const MobilityConstraintOutputSchema = z.object({
  maxWalkMinutesPerLeg: z.number().int().min(1).max(60),
  avoidSteepInclineOrStairs: z.boolean(),
  preferredTransit: z.enum(['subway', 'bus', 'walk', 'taxi']).nullable(),
});

const DayTripOutputSchema = z.object({
  dayNumber: z.number().int(),
  date: z.string().nullable(),
  title: z.string().nullable(),
  area: z.string().nullable(),
  startTime: z.string(),
  endTime: z.string(),
  dailyBudgetKrw: z.number().int().nullable(),
  startAnchor: AnchorPlaceOutputSchema.nullable(),
  endAnchor: AnchorPlaceOutputSchema.nullable(),
  fixedAppointments: z.array(FixedAppointmentOutputSchema),
  mealWindows: z.array(MealWindowOutputSchema),
  mustVisitPlaces: z.array(z.string()),
  interests: z.array(z.string()),
  preferences: z.array(z.string()),
  avoid: z.array(z.string()),
  maxWalkMinutes: z.number().int().min(1).max(60).nullable(),
  anchorPlace: AnchorPlaceOutputSchema.nullable(),
});

export const TripPreferenceOutputSchema = z.object({
  tripTitle: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  totalDays: z.number().int().nullable(),
  totalBudgetKrw: z.number().int().nullable(),
  partySize: z.number().int().nullable(),
  companions: CompanionSchema.nullable(),
  pace: PaceSchema.nullable(),
  baseCamp: BaseCampOutputSchema.nullable(),
  airport: z.string().nullable(),
  mobilityConstraint: MobilityConstraintOutputSchema.nullable(),
  userPriorities: z.array(UserPrioritySchema),
  rainFallbackPolicy: z.enum(['indoor_switch', 'keep']).nullable(),

  // Single-day backward compatibility shortcuts
  area: z.string().nullable(),
  startTime: z.string(),
  endTime: z.string(),
  budget: z.number().int().nullable(),
  interests: z.array(z.string()),
  preferences: z.array(z.string()),
  avoid: z.array(z.string()),
  maxWalkMinutes: z.number().int().min(1).max(60).nullable(),
  anchorPlace: AnchorPlaceOutputSchema.nullable(),

  // Hierarchical multi-day array
  days: z.array(DayTripOutputSchema),
});

export type TripPreferenceOutput = z.infer<typeof TripPreferenceOutputSchema>;
