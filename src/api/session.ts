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
  if (existsSync(SESSION_CACHE_PATH)) {
    const cached = await getBypassCookies();
    if (cached) return cached;
  }

  return refreshSession();
}

async function getBypassCookies(): Promise<{ cookies: string; userAgent: string } | null> {
  try {
    const cached: SessionCache = JSON.parse(
      await readFile(SESSION_CACHE_PATH, "utf-8"),
    );
    const config = (await import("../config/index.js")).loadConfig();
    const ageMinutes = (Date.now() - cached.timestamp) / 60000;
    if (ageMinutes < config.sessionCacheTtlMinutes) {
      logger.debug(`Using cached session (${ageMinutes.toFixed(1)} min old)`);
      const cookieStr = cached.cookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      return { cookies: cookieStr, userAgent: cached.userAgent };
    }
  } catch {
    logger.debug("Invalid session cache, will refresh");
  }
  return null;
}

export async function refreshSession(): Promise<{
  cookies: string;
  userAgent: string;
}> {
  logger.info("Launching browser to establish session...");

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: false,
      channel: "chrome",
      args: ["--disable-blink-features=AutomationControlled"],
    });

    const context: BrowserContext = await browser.newContext({
      locale: "en-US",
      timezoneId: "America/Vancouver",
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    await page.goto(BCPARKS_BASE_URL, {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    await page.waitForTimeout(3000);

    try {
      await page.waitForSelector("#root, .app, main", { timeout: 15000 });
    } catch {
      logger.warn("Page root element not found after load");
      await page.screenshot({ path: ".session-debug.png", fullPage: false }).catch(() => {});
    }

    await page.waitForTimeout(2000);

    try {
      const resp = await page.goto(
        `${BCPARKS_BASE_URL}/api/resourceLocation`,
        { waitUntil: "domcontentloaded", timeout: 15000 },
      );
      if (resp?.status() === 200) {
        logger.info("API endpoint accessible after session bootstrap");
      } else {
        logger.warn("API endpoint status: %d", resp?.status() ?? -1);
      }
    } catch (error) {
      logger.warn("API endpoint navigation failed: %s", error);
    }

    const cookies = await context.cookies();
    const userAgent = await page.evaluate(() => navigator.userAgent);

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
