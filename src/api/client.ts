import { loadConfig } from "../config/index.js";
import { BCPARKS_BASE_URL } from "../config/constants.js";
import { getSession, refreshSession } from "./session.js";
import { withRetry } from "../utils/retry.js";
import { sleep } from "../utils/sleep.js";
import { logger } from "../utils/logger.js";

let sessionData: { cookies: string; userAgent: string } | null = null;
let lastRequestTime = 0;

async function ensureSession(): Promise<{
  cookies: string;
  userAgent: string;
}> {
  if (!sessionData) {
    const config = loadConfig();
    sessionData = await getSession(config.sessionCacheTtlMinutes);
  }
  return sessionData;
}

async function throttle(): Promise<void> {
  const config = loadConfig();
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < config.requestDelayMs) {
    await sleep(config.requestDelayMs - elapsed);
  }
  lastRequestTime = Date.now();
}

export interface ApiRequestOptions {
  method?: "GET" | "POST";
  params?: Record<string, string | number | boolean>;
  body?: unknown;
  headers?: Record<string, string>;
  skipSession?: boolean;
}

/**
 * Make an API request to the BC Parks GoingToCamp API.
 * Handles session management, rate limiting, and retry logic.
 */
export async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { method = "GET", params, body, skipSession = false } = options;

  return withRetry(
    async () => {
      await throttle();

      const session = skipSession ? null : await ensureSession();
      const url = new URL(endpoint, BCPARKS_BASE_URL);

      if (params) {
        for (const [key, value] of Object.entries(params)) {
          url.searchParams.set(key, String(value));
        }
      }

      const allHeaders: Record<string, string> = {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `${BCPARKS_BASE_URL}/`,
        Origin: BCPARKS_BASE_URL,
        ...options.headers,
      };

      if (session) {
        allHeaders["Cookie"] = session.cookies;
        allHeaders["User-Agent"] = session.userAgent;
      }

      if (body) {
        allHeaders["Content-Type"] = "application/json";
      }

      logger.debug({ method, url: url.toString() }, "API request");

      const response = await fetch(url.toString(), {
        method,
        headers: allHeaders,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (response.status === 403) {
        logger.warn("Got 403, refreshing session...");
        sessionData = await refreshSession();
        throw new Error("Session expired (403), retrying with fresh session");
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `API error ${response.status}: ${response.statusText} - ${text}`,
        );
      }

      return (await response.json()) as T;
    },
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      onRetry: (error, attempt) => {
        logger.warn({ err: error, attempt }, "Retrying API request");
      },
    },
  );
}

/**
 * Reset the session (for testing or manual refresh).
 */
export function resetSession(): void {
  sessionData = null;
}
