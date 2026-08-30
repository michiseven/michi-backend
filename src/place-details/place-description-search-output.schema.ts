import { z } from 'zod';

export const PlaceDescriptionSearchOutputSchema = z.object({
  placeMatched: z.boolean(),
  matchedName: z.string().max(255).nullable(),
  matchedAddress: z.string().max(500).nullable(),
  descriptionKo: z.string().min(1).max(700).nullable(),
  descriptionJa: z.string().min(1).max(700).nullable(),
  sourceUrls: z.array(z.string().min(1).max(2048)).min(1).max(5),
  warnings: z.array(z.string().max(500)).max(8),
});

export type PlaceDescriptionSearchOutput = z.infer<typeof PlaceDescriptionSearchOutputSchema>;
