import { chromium, type Browser, type BrowserContext } from "playwright";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { logger } from "../utils/logger.js";
import { BCPARKS_BASE_URL } from "../config/constants.js";

const SESSION_CACHE_PATH = ".session-cache.json";

interface SessionCache {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
  }>;
  userAgent: string;
  timestamp: number;
}

/**
 * Bootstrap a browser session to extract cookies that bypass bot protection.
 * Cookies are cached locally to avoid repeated browser launches.
 */
export async function getSession(
  ttlMinutes: number = 30,
): Promise<{ cookies: string; userAgent: string }> {
  // Try loading cached session
  if (existsSync(SESSION_CACHE_PATH)) {
    try {
      const cached: SessionCache = JSON.parse(
        await readFile(SESSION_CACHE_PATH, "utf-8"),
      );
      const ageMinutes = (Date.now() - cached.timestamp) / 60000;
      if (ageMinutes < ttlMinutes) {
        logger.debug(`Using cached session (${ageMinutes.toFixed(1)} min old)`);
        const cookieStr = cached.cookies
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
        return { cookies: cookieStr, userAgent: cached.userAgent };
      }
    } catch {
      logger.debug("Invalid session cache, will refresh");
    }
  }

  return refreshSession();
}

export async function refreshSession(): Promise<{
  cookies: string;
  userAgent: string;
}> {
  logger.info("Launching browser to establish session...");

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context: BrowserContext = await browser.newContext({
      locale: "en-US",
      timezoneId: "America/Vancouver",
    });

    const page = await context.newPage();

    // Visit the main site to get cookies set
    await page.goto(BCPARKS_BASE_URL, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Wait a moment for any JS-set cookies
    await page.waitForTimeout(2000);

    const cookies = await context.cookies();
    const userAgent = await page.evaluate(() => navigator.userAgent);

    // Cache the session
    const cache: SessionCache = {
      cookies: cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
      })),
      userAgent,
      timestamp: Date.now(),
    };

    await writeFile(SESSION_CACHE_PATH, JSON.stringify(cache, null, 2));
    logger.info("Session established and cached (%d cookies)", cookies.length);

    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    return { cookies: cookieStr, userAgent };
  } finally {
    if (browser) await browser.close();
  }
}
