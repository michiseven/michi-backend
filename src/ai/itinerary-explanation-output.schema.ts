import { z } from 'zod';

export const StopExplanationOutputSchema = z.object({
  order: z
    .number()
    .int()
    .min(1)
    .describe('1-based sequential order matching the input stop exactly'),
  placeId: z.string().min(1).max(120).describe('Exact placeId matching the input stop'),
  shortDescription: z
    .string()
    .min(1)
    .max(300)
    .describe('Concise factual introduction of the place based only on verified facts'),
  previousStopFit: z
    .string()
    .min(1)
    .max(300)
    .nullable()
    .describe(
      'Why this place connects smoothly from the previous place. Must be null for the first stop of the itinerary or the first stop of each day',
    ),
  nextStopFit: z
    .string()
    .min(1)
    .max(300)
    .nullable()
    .describe(
      'Why this place connects smoothly to the next place. Must be null for the last stop of the itinerary or the last stop of each day',
    ),
  overallTripFit: z
    .string()
    .min(1)
    .max(300)
    .describe('Why this place fits the user preferences and overall trip theme'),
});

export const ItineraryExplanationOutputSchema = z.object({
  tripSummary: z
    .string()
    .min(1)
    .max(500)
    .describe('Cohesive overview summarizing the theme and flow of the entire itinerary'),
  stops: z
    .array(StopExplanationOutputSchema)
    .min(1)
    .describe('Explanations for all stops in the exact order of the itinerary'),
});

export type ItineraryExplanationOutput = z.infer<typeof ItineraryExplanationOutputSchema>;
