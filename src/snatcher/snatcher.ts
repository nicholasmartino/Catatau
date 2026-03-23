import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { findCampgrounds, checkAvailability } from "../availability/checker.js";
import { buildSimpleBookingUrl } from "../booking/url-builder.js";
import { NotificationManager } from "../notifications/manager.js";
import { loadConfig } from "../config/index.js";
import {
  formatDate,
  getNextReleaseDate,
  msUntilNext7am,
  nowPacific,
} from "../utils/dates.js";
import { sleep } from "../utils/sleep.js";
import { logger } from "../utils/logger.js";
import { BCPARKS_BASE_URL } from "../config/constants.js";
import type { Campground } from "../types/park.js";

export interface SnatcherOptions {
  parkName: string;
  startDate?: string;     // yyyy-MM-dd; if omitted, uses next release date
  endDate?: string;       // yyyy-MM-dd; if omitted, uses startDate + nights
  nights?: number;
  partySize?: number;
  equipmentCategoryId?: number;
  subEquipmentCategoryId?: number;
  headless?: boolean;
  preWarmMinutes?: number; // how many minutes before 7 AM to start (default 5)
}

/**
 * The Snatcher - runs N minutes before the booking window opens,
 * pre-warms browser sessions, and aggressively tries to book the
 * moment availability appears.
 *
 * Strategy:
 * 1. Pre-warm: Launch browser, visit site, establish cookies (T-5 min)
 * 2. Pre-load: Navigate to booking page with params pre-filled (T-2 min)
 * 3. API blitz: Hammer the availability API starting at T-10s (every 1s)
 * 4. When found: Auto-navigate browser to first available site
 * 5. Continue polling API in parallel for more options
 */
export async function runSnatcher(options: SnatcherOptions): Promise<void> {
  const config = loadConfig();
  const {
    parkName,
    nights = 2,
    partySize = config.defaultPartySize,
    equipmentCategoryId = config.defaultEquipmentCategoryId,
    subEquipmentCategoryId,
    headless = false,
    preWarmMinutes = 5,
  } = options;

  const notifier = new NotificationManager();

  // Resolve campground
  logger.info("Resolving campground: %s", parkName);
  const campgrounds = await findCampgrounds(parkName);
  if (campgrounds.length === 0) {
    logger.error('No campgrounds found matching "%s"', parkName);
    process.exit(1);
  }

  const campground = campgrounds[0];
  logger.info("Target campground: %s (ID: %d)", campground.name, campground.id);

  // Calculate target date
  let targetStartDate: string;
  let targetEndDate: string;

  if (options.startDate) {
    targetStartDate = options.startDate;
    targetEndDate = options.endDate || addDays(options.startDate, nights);
  } else {
    // Default: the date being released at next 7 AM
    const releaseDate = getNextReleaseDate();
    targetStartDate = formatDate(releaseDate);
    targetEndDate = formatDate(new Date(releaseDate.getTime() + nights * 86400000));
  }

  logger.info("Target dates: %s to %s (%d nights)", targetStartDate, targetEndDate, nights);

  // Build the booking URL
  const bookingUrl = buildSimpleBookingUrl({
    mapId: campground.mapId,
    resourceLocationId: campground.id,
    startDate: targetStartDate,
    endDate: targetEndDate,
    partySize,
  });

  logger.info("Booking URL: %s", bookingUrl);

  // Calculate wait time
  const msUntil = msUntilNext7am();
  const preWarmMs = preWarmMinutes * 60 * 1000;
  const waitUntilPreWarm = Math.max(0, msUntil - preWarmMs);

  if (waitUntilPreWarm > 0) {
    const waitMinutes = (waitUntilPreWarm / 60000).toFixed(1);
    logger.info(
      "Waiting %s minutes until pre-warm phase starts (%d min before 7 AM)...",
      waitMinutes,
      preWarmMinutes,
    );
    logger.info("Press Ctrl+C to cancel.");
    await sleep(waitUntilPreWarm);
  }

  // ==========================================
  // PHASE 1: PRE-WARM (T minus 5 min)
  // ==========================================
  logger.info("=== PHASE 1: PRE-WARMING BROWSER ===");

  const browser = await chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/Vancouver",
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  // Visit main page to establish session cookies
  logger.info("Visiting main site to warm cookies...");
  await page.goto(BCPARKS_BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);

  // Pre-login hint: if the user is already logged in via cookies, great.
  // Otherwise they can log in manually in the browser window.
  if (!headless) {
    logger.info("Browser is open. If you need to log in, do it now.");
    logger.info("You have %d minutes before the booking window opens.", preWarmMinutes);
  }

  // ==========================================
  // PHASE 2: PRE-LOAD BOOKING PAGE (T minus 2 min)
  // ==========================================
  const msUntilBooking = msUntilNext7am();
  const preLoadWait = Math.max(0, msUntilBooking - 120000); // 2 min before
  if (preLoadWait > 0) {
    logger.info(`Waiting ${Math.round(preLoadWait / 1000)} seconds to pre-load booking page...`);
    await sleep(preLoadWait);
  }

  logger.info("=== PHASE 2: PRE-LOADING BOOKING PAGE ===");
  await page.goto(bookingUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {
    logger.warn("Pre-load navigation timed out, continuing...");
  });

  // ==========================================
  // PHASE 3: API BLITZ (T minus 10s)
  // ==========================================
  const msUntilBlitz = msUntilNext7am();
  const blitzWait = Math.max(0, msUntilBlitz - 10000); // 10 seconds before
  if (blitzWait > 0) {
    logger.info(`Waiting ${Math.round(blitzWait / 1000)} seconds for API blitz...`);
    await sleep(blitzWait);
  }

  logger.info("=== PHASE 3: API BLITZ - HAMMERING AVAILABILITY API ===");

  let found = false;
  const maxBlitzAttempts = 120; // 2 minutes of checking at 1/sec
  const blitzIntervalMs = 1000;

  for (let attempt = 1; attempt <= maxBlitzAttempts; attempt++) {
    const now = nowPacific();
    const timeStr = now.toLocaleTimeString("en-US", { timeZone: "America/Vancouver" });
    logger.info("Blitz #%d at %s", attempt, timeStr);

    try {
      const sites = await checkAvailability({
        campground,
        startDate: new Date(targetStartDate + "T00:00:00"),
        endDate: new Date(targetEndDate + "T00:00:00"),
        partySize,
        equipmentCategoryId,
        subEquipmentCategoryId,
      });

      if (sites.length > 0) {
        found = true;
        logger.info("FOUND %d AVAILABLE SITES!", sites.length);

        // Notify immediately
        const bookingUrls = [...new Set(sites.map((s) => s.bookingUrl))];
        await notifier.notify({
          title: `SNATCHER: ${sites.length} sites at ${campground.name}!`,
          message: `Dates ${targetStartDate} to ${targetEndDate} - BOOK NOW!`,
          sites,
          bookingUrls,
          parkName: campground.name,
          startDate: targetStartDate,
          endDate: targetEndDate,
        });

        // Refresh the browser page to show updated results
        logger.info("Refreshing browser to show available sites...");
        await page.goto(bookingUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

        // Try to auto-select a site
        await sleep(3000);
        await tryAutoSelect(page);

        logger.info("Sites found! Browser is open for booking.");
        logger.info("You have 15 minutes to complete the reservation.");

        if (!headless) {
          // Keep browser open for manual completion
          await waitForUserOrTimeout(300000); // 5 min wait, user can keep going
        }

        break;
      }
    } catch (error) {
      logger.warn("Blitz check failed: %s", String(error));
    }

    if (attempt < maxBlitzAttempts) {
      await sleep(blitzIntervalMs);
    }
  }

  if (!found) {
    logger.warn("Snatcher: no availability found after %d attempts.", maxBlitzAttempts);
    logger.info("The browser will remain open. You can try manually.");

    if (!headless) {
      await waitForUserOrTimeout(600000); // keep open 10 min
    }
  }

  await browser.close();
  logger.info("Snatcher complete.");
}

async function tryAutoSelect(page: Page): Promise<void> {
  const selectors = [
    '[class*="available"]',
    'button:has-text("Book")',
    'button:has-text("Reserve")',
    'button:has-text("Add")',
    '[data-available="true"]',
  ];

  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    if (count > 0) {
      logger.info("Auto-clicking: %s (%d matches)", selector, count);
      await page.locator(selector).first().click();
      await sleep(1000);

      // Try to click book button
      const bookBtns = [
        'button:has-text("Add to Stay")',
        'button:has-text("Book Now")',
        'button:has-text("Reserve")',
      ];
      for (const btn of bookBtns) {
        const el = page.locator(btn).first();
        if (await el.isVisible().catch(() => false)) {
          logger.info("Clicking book button: %s", btn);
          await el.click();
          return;
        }
      }
      return;
    }
  }

  logger.warn("Could not auto-select. Please select a site manually.");
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

async function waitForUserOrTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);

    process.once("SIGINT", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
