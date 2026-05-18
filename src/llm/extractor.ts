import { loadConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type { ExtractedIntent } from "./types.js";

const SYSTEM_PROMPT = `You are a camping reservation assistant for BC Parks. Extract booking intent from the user's natural language request.

Available commands:
- "hunt" = continuous monitoring with auto-cart, fast interval (30s)
- "monitor" = continuous monitoring without auto-cart, standard interval (300s)
- "check" = single availability check
- "snatch" = pre-warmed booking at 7 AM release

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
  required: ["park"],
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

export async function extractIntent(text: string): Promise<ExtractedIntent> {
  const config = loadConfig();
  const apiUrl = config.opencodeApiUrl;

  const session = await apiFetch(apiUrl, "/session", {
    method: "POST",
    body: JSON.stringify({ title: "Intent Extraction" }),
  }) as { id: string };

  try {
    const result = await apiFetch(apiUrl, `/session/${session.id}/message`, {
      method: "POST",
      body: JSON.stringify({
        system: SYSTEM_PROMPT,
        parts: [{ type: "text", text }],
        format: { type: "json_schema", schema: INTENT_SCHEMA },
      }),
    }) as { info: { structured?: Record<string, unknown> } };

    const structured = result.info.structured as ExtractedIntent | undefined;
    logger.info({ structured }, "Extracted intent");
    return structured ?? {};
  } finally {
    await apiFetch(apiUrl, `/session/${session.id}`, {
      method: "DELETE",
    }).catch(() => {});
  }
}
