import { logger } from "../utils/logger.js";
import type { ExtractedIntent } from "./types.js";

const SYSTEM_PROMPT = `You are a camping reservation assistant for BC Parks. Help the user plan their trip by having a natural conversation.

You MUST respond with ONLY a valid JSON object. No other text before or after.

The JSON object must have this exact schema:
{
  "reply": "<your conversational message to the user (REQUIRED)>",
  "park": "<park or campground name, if stated>",
  "startDate": "<start date in YYYY-MM-DD format, if stated>",
  "endDate": "<end date in YYYY-MM-DD format, if stated>",
  "nights": <number of nights, if stated>,
  "partySize": <number of people, if stated>
}

Rules:
- "reply" is REQUIRED. It must be a natural conversational message.
- Fill booking fields ONLY when the user clearly states specific values.
- Collect these through conversation:
  1. Park or campground name
  2. Check-in date
  3. Check-out date
  4. Number of people
- If the user mentions a region (like "Sunshine Coast") instead of a specific park, suggest real reservable BC Parks campgrounds in that area in your reply. Do NOT set the park field for a region name.
- If the user asks an open-ended question, ask follow-ups to narrow it down.
- Be helpful, natural, and specific. Do NOT guess or make up park names, dates, or party sizes.

Parse dates intelligently:
- "june 1" or "June 1st" -> 2026-06-01
- "tomorrow" -> calculate from context
- "next weekend" -> the upcoming weekend
- Always output dates in YYYY-MM-DD format
- If the user mentions a date without specifying year, use 2026 (current year).
- If only one date is given, treat it as the start date and set nights to 1.
- Dates like "june 1 to june 3" mean start=june 1, end=june 3.

OUTPUT ONLY JSON. DO NOT include any text outside the JSON object.`;

function parseJsonFromText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  // Try direct parse first
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {}
  // Try extracting from markdown code block
  const blockMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (blockMatch) {
    try {
      const parsed = JSON.parse(blockMatch[1]);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {}
  }
  // Try finding any JSON object in the text
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {}
  }
  return null;
}

async function apiFetch(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenCode API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function extractIntent(
  text: string,
  apiUrl: string,
  context?: { existingIntent: Partial<ExtractedIntent>; command: string },
): Promise<ExtractedIntent> {
  let system = SYSTEM_PROMPT;

  if (context) {
    const known = context.existingIntent;
    const fields: string[] = [];
    if (context.command) fields.push(`Command: ${context.command}`);
    if (known.park) fields.push(`Park: ${known.park}`);
    if (known.startDate) fields.push(`Start date: ${known.startDate}`);
    if (known.endDate) fields.push(`End date: ${known.endDate}`);
    if (known.partySize !== undefined) fields.push(`Party size: ${known.partySize}`);

    system += [
      "",
      "",
      "Previously collected information (do NOT repeat in your output):",
      ...(fields.length > 0 ? fields.map(f => `- ${f}`) : ["- (none yet)"]),
      "",
      "Extract new booking fields from the user's latest message.",
      "Do NOT output any of the fields listed above.",
      "If a date is provided and the corresponding field is already collected,",
      "interpret it as the next missing date field.",
      "If the user's message doesn't contain new booking information,",
      "respond conversationally in the reply field instead.",
    ].join("\n");
  }

  const session = await apiFetch(apiUrl, "/session", {
    method: "POST",
    body: JSON.stringify({ title: "Intent Extraction" }),
  }) as { id: string };

  try {
    const result = await apiFetch(apiUrl, `/session/${session.id}/message`, {
      method: "POST",
      body: JSON.stringify({
        system,
        parts: [{ type: "text", text }],
      }),
    }) as {
      info: { error?: { data?: { message?: string } }; tokens?: { input: number; output: number } };
      parts: Array<{ type: string; text?: string }>;
    };

    if (result.info?.error) {
      logger.error({ error: result.info.error }, "LLM API error");
      return { reply: "I ran into an issue processing that. Could you try rephrasing?" };
    }

    const rawText = result.parts?.find(p => p.type === "text")?.text ?? "";
    const parsed = parseJsonFromText(rawText);
    const intent: ExtractedIntent = (parsed as ExtractedIntent) ?? {};

    if (!intent.reply) {
      intent.reply = rawText.slice(0, 500);
    }

    logger.info({ intent, tokens: result.info?.tokens }, "Extracted intent");
    return intent;
  } finally {
    await apiFetch(apiUrl, `/session/${session.id}`, {
      method: "DELETE",
    }).catch(() => {});
  }
}
