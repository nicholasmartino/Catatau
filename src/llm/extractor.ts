import { logger } from "../utils/logger.js";
import type { ExtractedIntent } from "./types.js";

const SYSTEM_PROMPT = `You are a camping reservation assistant for BC Parks. Help the user plan their trip by having a natural conversation.

For EVERY response, output:
- \`reply\` (REQUIRED): A natural conversational message to send back to the user.
- Booking fields (optional): Fill these ONLY when the user clearly states specific values.

Collect these through conversation:
1. Park or campground name
2. Check-in date
3. Check-out date
4. Number of people

If the user mentions a region (like "Sunshine Coast") instead of a specific park, suggest real reservable BC Parks campgrounds in that area in your reply. Do NOT set the park field for a region name.
If the user asks an open-ended question, ask follow-ups to narrow it down.
Be helpful, natural, and specific. Do NOT guess or make up park names, dates, or party sizes.

Parse dates intelligently:
- "june 1" or "June 1st" -> 2026-06-01
- "tomorrow" -> calculate from context
- "next weekend" -> the upcoming weekend
- Always output dates in YYYY-MM-DD format

If the user mentions a date without specifying year, use 2026 (current year).
If only one date is given, treat it as the start date and set nights to 1.
Dates like "june 1 to june 3" mean start=june 1, end=june 3.`;

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "Natural conversational reply to send to the user. REQUIRED.",
    },
    park: { type: "string", description: "Park or campground name" },
    startDate: {
      type: "string",
      description: "Start date in YYYY-MM-DD format",
    },
    endDate: { type: "string", description: "End date in YYYY-MM-DD format" },
    nights: { type: "integer", description: "Number of nights to stay" },
    partySize: { type: "integer", description: "Number of people" },
    interval: {
      type: "integer",
      description: "Check interval in seconds (leave null for defaults)",
    },
  },
  required: ["reply"],
};

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
        format: { type: "json_schema", schema: INTENT_SCHEMA },
      }),
    }) as { info: { structured?: Record<string, unknown> }; parts: Array<{ type: string; text?: string }> };

    const structured = result.info.structured as ExtractedIntent | undefined;
    const textPart = result.parts?.find(p => p.type === "text");
    const replyFromText = textPart?.text;

    let intent: ExtractedIntent = structured ?? {};
    if (!intent.reply && replyFromText) {
      intent = { ...intent, reply: replyFromText };
    }

    logger.info({ intent }, "Extracted intent");
    return intent;
  } finally {
    await apiFetch(apiUrl, `/session/${session.id}`, {
      method: "DELETE",
    }).catch(() => {});
  }
}
