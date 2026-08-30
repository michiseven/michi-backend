import { z } from 'zod';

const FactSchema = z.object({
  status: z.enum(['sourced', 'conflicting', 'unavailable']),
  value: z.string().max(1000).nullable(),
  // URL 형식은 검색 도구가 실제 반환한 URL 집합과의 교차검증 단계에서 판정한다.
  // OpenAI Structured Outputs strict subset은 JSON Schema `format: uri`를 받지 않는다.
  sourceUrls: z.array(z.string().min(1).max(2048)).max(5),
});

export const PlaceDetailSearchOutputSchema = z.object({
  placeMatched: z.boolean(),
  matchedName: z.string().max(255).nullable(),
  matchedAddress: z.string().max(500).nullable(),
  businessHours: FactSchema,
  price: FactSchema,
  warnings: z.array(z.string().max(500)).max(8),
});

export type PlaceDetailSearchOutput = z.infer<typeof PlaceDetailSearchOutputSchema>;
