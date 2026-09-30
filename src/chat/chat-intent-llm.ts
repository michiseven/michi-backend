import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type { ClassifiedIntent } from './chat-intent';

const IntentOutputSchema = z.object({
  intent: z.enum(['qa', 'clarify', 'create_trip', 'modify_trip']),
  readiness: z.enum(['ready', 'ready_with_defaults', 'needs_one_answer', 'blocked']),
  area: z.string().nullable(),
  activities: z.array(z.string()),
  missingRequirement: z
    .enum(['meal', 'area', 'time_conflict', 'modification_target', 'direction'])
    .nullable(),
  clarificationQuestion: z.string().nullable(),
  clarificationKind: z.enum(['meal', 'general']).nullable(),
});

const INSTRUCTIONS = `You classify the latest message for Michi, a Seoul itinerary planner.
Return only the requested structured object.

Treat natural language such as "걷고 싶어요", "즐기고 싶어요", "방문하고 싶어요" as a trip request when it expresses a Seoul area or activity.
The default user is a first-time Japanese visitor who knows nothing about Seoul. Missing time, party size or budget alone can use product defaults. A missing area can use a suggested area only when the user has supplied a concrete activity or explicitly delegated the choice.
Ask exactly one short clarification when the user has supplied neither a concrete area nor an activity, or a missing fact changes safety or makes the itinerary impossible (for example: an ambiguous place replacement, contradictory flight/appointment times, accessibility requirements with no usable location/time).
If the user asks for a meal or the requested itinerary needs a meal but cuisine is unspecified, ask one meal clarification before creating the itinerary. Set clarificationKind=meal and offer Korean, Japanese, Chinese, Western, cafe/dessert, or a local specialty recommendation.
For a very vague request with neither a concrete area nor an activity, ask one direction question and set missingRequirement=direction.
"友達と週末にソウルで遊びたい" has neither: Seoul is the service city, not a concrete neighbourhood, and "遊びたい" is not a concrete activity. Return clarify, needs_one_answer, direction, area=null, activities=[]. Do not invent a neighbourhood or activity to make it ready. An explicit "choose everything for me" is different and permits defaults.
Extract activities and the Seoul area from the whole conversation; resolve a short answer against the earlier request. Return the area in Korean when possible. Never drop dietary restrictions or explicit activities after a meal answer.
Missing time, party size and budget are defaults, not missing requirements. A concrete area and activity (e.g. 종로에서 전통찻집과 역사 산책) is ready_with_defaults. Do not ask its atmosphere again.
For clarify, name the missingRequirement and write exactly one contextual question in the user's language. Do not ask about information already supplied. Use null for missingRequirement when ready.
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

    return {
      intent: parsed.intent,
      readiness: parsed.readiness,
      activities: parsed.activities,
      missingRequirement: parsed.missingRequirement,
      clarificationQuestion: parsed.clarificationQuestion,
      clarificationKind: parsed.clarificationKind,
      ...(['create_trip', 'clarify'].includes(parsed.intent)
        ? { createTripInput: { text: message.trim(), startArea: parsed.area ?? undefined } }
        : {}),
    };
  } catch {
    // A provider outage must not make chat unavailable; the deterministic
    // classifier is retained only as a safe fallback.
    return null;
  }
}
