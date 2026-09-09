import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type { ClassifiedIntent } from './chat-intent';

const IntentOutputSchema = z.object({
  intent: z.enum(['qa', 'clarify', 'create_trip', 'modify_trip']),
  readiness: z.enum(['ready', 'ready_with_defaults', 'needs_one_answer', 'blocked']),
  area: z.string().nullable(),
  clarificationQuestion: z.string().nullable(),
  clarificationKind: z.enum(['meal', 'general']).nullable(),
});

const INSTRUCTIONS = `You classify the latest message for Michi, a Seoul itinerary planner.
Return only the requested structured object.

Treat natural language such as "걷고 싶어요", "즐기고 싶어요", "방문하고 싶어요" as a trip request when it expresses a Seoul area or activity.
The default user is a first-time Japanese solo visitor who knows nothing about Seoul. Do not ask a question merely because area, time, party size, or budget is missing: create a draft using product defaults instead.
Ask exactly one short clarification only when a missing fact changes safety or makes the itinerary impossible (for example: an ambiguous place replacement, contradictory flight/appointment times, accessibility requirements with no usable location/time).
If the user asks for a meal or the requested itinerary needs a meal but cuisine is unspecified, ask one meal clarification before creating the itinerary. Set clarificationKind=meal and offer Korean, Japanese, Chinese, Western, cafe/dessert, or a local specialty recommendation.
Use clarify only for that case. For a blank or very vague request, create_trip with readiness ready_with_defaults.
Use qa only for a factual question about a place, and modify_trip only for an existing itinerary edit request.`;

export async function classifyIntentWithLlm(
  apiKey: string | undefined,
  message: string,
  hasActiveTrip: boolean,
  conversation: string,
): Promise<ClassifiedIntent | null> {
  if (!apiKey) return null;
  try {
    const client = new OpenAI({ apiKey });
    const response = await client.responses.parse({
      model: process.env.OPENAI_MODEL ?? 'gpt-5.6-luna',
      input: [
        { role: 'system', content: INSTRUCTIONS },
        {
          role: 'user',
          content: `hasActiveTrip: ${hasActiveTrip}\nconversation:\n${conversation}\nlatest message: ${message}`,
        },
      ],
      text: { format: zodTextFormat(IntentOutputSchema, 'chat_intent') },
    });
    const parsed = response.output_parsed;
    if (!parsed) return null;

    if (parsed.intent === 'create_trip') {
      return {
        intent: 'create_trip',
        createTripInput: {
          text: message.trim(),
          // The preference parser applies the full first-visitor defaults.
          startArea: parsed.area ?? undefined,
        },
      };
    }
    if (parsed.intent === 'clarify' && parsed.readiness === 'needs_one_answer') {
      return {
        intent: 'clarify',
        clarificationQuestion: parsed.clarificationQuestion,
        clarificationKind: parsed.clarificationKind,
      };
    }
    return { intent: parsed.intent };
  } catch {
    // A provider outage must not make chat unavailable; the deterministic
    // classifier is retained only as a safe fallback.
    return null;
  }
}
