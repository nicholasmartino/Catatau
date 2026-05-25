import { chromium, type Browser, type Page } from "playwright";
import { loadConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { BCPARKS_BASE_URL } from "../config/constants.js";
import { loginToBCParks } from "./login.js";

export interface BookingOptions {
  bookingUrl: string;
  headless?: boolean;
  timeout?: number;
  resourceIds?: number[];
}

export interface BookingResult {
  success: boolean;
  message: string;
  step: string;
}

/**
 * Automate the booking flow using Playwright.
 *
 * Flow:
 * 1. Navigate to the booking URL (pre-filled search results)
 * 2. Handle Queue-It waiting room if present
 * 3. Select first available site
 * 4. Click "Book" / "Add to Stay"
 * 5. Pause for user to complete payment (or auto-fill if configured)
 */
export async function automateBooking(
  options: BookingOptions,
): Promise<BookingResult> {
  const config = loadConfig();
  const {
    bookingUrl,
    headless = config.bookingHeadless,
    timeout = 120000,
  } = options;

  let browser: Browser | null = null;

  try {
    logger.info("Launching browser for booking...");

    browser = await chromium.launch({
      headless,
      slowMo: 100, // Slow down to appear more human
    });

    const context = await browser.newContext({
      locale: "en-US",
      timezoneId: "America/Vancouver",
      viewport: { width: 1440, height: 900 },
    });

    const page = await context.newPage();

    // Step 1: Log in to BC Parks if credentials configured
    const loginResult = await loginToBCParks();
    if (loginResult) {
      logger.info("Injecting auth cookies into browser context...");
      await context.addCookies(loginResult.cookies);
    }

    // Step 3: Navigate to booking URL
    logger.info("Navigating to booking page...");
    await page.goto(bookingUrl, { waitUntil: "networkidle", timeout: 60000 });

    // Step 4: Check for Queue-It
    const isQueueIt = await detectQueueIt(page);
    if (isQueueIt) {
      logger.info("Queue-It waiting room detected. Waiting for queue...");
      await waitForQueueIt(page, timeout);
      logger.info("Through the queue!");
    }

    // Step 5: Wait for search results to load
    logger.info("Waiting for search results...");
    await page.waitForSelector(
      '[class*="resource"], [class*="site"], [class*="result"], [class*="available"]',
      { timeout: 30000 },
    ).catch(() => {
      logger.warn("Could not detect standard result selectors, continuing...");
    });

    // Step 6: Try to select first available site
    logger.info("Looking for available sites...");

    // The GoingToCamp UI typically shows available sites with green indicators
    // or clickable site buttons. Try multiple selector strategies.
    const siteSelected = await trySelectSite(page, options.resourceIds);

    if (!siteSelected) {
      logger.warn(
        "Could not auto-select a site. Browser is open for manual selection.",
      );

      if (!headless) {
        logger.info(
          "Please select a site manually in the browser window.",
        );
        logger.info("The browser will stay open. Press Ctrl+C to close.");

        // Keep browser open for manual interaction
        await new Promise(() => {}); // block forever
      }

      return {
        success: false,
        message: "Could not auto-select site. Manual intervention needed.",
        step: "site-selection",
      };
    }

    // Step 7: Click book/reserve button
    logger.info("Attempting to add site to booking...");
    const booked = await tryBookSite(page);

    if (booked) {
      logger.info(
        "Site added to cart! Complete payment in the browser window.",
      );

      if (!headless) {
        logger.info("Browser will remain open for payment.");
        logger.info("You have 15 minutes to complete the booking.");
        // Keep browser open
        await new Promise(() => {});
      }

      return {
        success: true,
        message: "Site added to cart. Complete payment manually.",
        step: "payment",
      };
    }

    return {
      success: false,
      message: "Could not complete booking automation.",
      step: "book-button",
    };
  } catch (error) {
    logger.error({ error }, "Booking automation failed");
    return {
      success: false,
      message: String(error),
      step: "error",
    };
  }
  // Note: browser intentionally kept open for manual payment
}

async function detectQueueIt(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("queue-it") || url.includes("queue.it")) return true;

  const hasQueueElements = await page
    .locator('[id*="queue"], [class*="queue-it"]')
    .count();
  return hasQueueElements > 0;
}

async function waitForQueueIt(page: Page, timeout: number): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const url = page.url();
    // If we've been redirected back to the booking site, we're through
    if (
      url.includes(BCPARKS_BASE_URL) &&
      !url.includes("queue")
    ) {
      return;
    }

    // Log queue position if visible
    const positionEl = await page
      .locator('[id*="position"], [class*="position"]')
      .first();
    if (await positionEl.isVisible().catch(() => false)) {
      const position = await positionEl.textContent();
      if (position) {
        logger.info("Queue position: %s", position.trim());
      }
    }

    await page.waitForTimeout(5000);
  }

  throw new Error("Queue-It timeout exceeded");
}

async function trySelectSite(page: Page, resourceIds?: number[]): Promise<boolean> {
  // Strategy 1: Click a site marker matching a known-available resource ID
  if (resourceIds && resourceIds.length > 0) {
    for (const id of resourceIds) {
      const selector = `[data-resource-id="${id}"]`;
      const count = await page.locator(selector).count();
      if (count > 0) {
        logger.info("Clicking site marker for resource ID %d", id);
        await page.locator(selector).first().click();
        await page.waitForTimeout(1000);
        return true;
      }
    }
  }

  // Strategy 2: Click on an available site marker (excluding unavailable)
  const availableMarkers = [
    '[class*="available"]:not([class*="unavailable"])',
    '.fa-map-marker-check.text-success',
    '[style*="green"]',
    '[data-available="true"]',
    '[class*="site-available"]',
  ];

  for (const selector of availableMarkers) {
    const count = await page.locator(selector).count();
    if (count > 0) {
      logger.info("Found available site with selector: %s", selector);
      await page.locator(selector).first().click();
      await page.waitForTimeout(1000);
      return true;
    }
  }

  // Strategy 3: Look for a list view with bookable entries
  const listSelectors = [
    'button:has-text("Book")',
    'button:has-text("Reserve")',
    'button:has-text("Add")',
    'a:has-text("Book Site")',
  ];

  for (const selector of listSelectors) {
    const count = await page.locator(selector).count();
    if (count > 0) {
      logger.info("Found book button with selector: %s", selector);
      await page.locator(selector).first().click();
      await page.waitForTimeout(1000);
      return true;
    }
  }

  return false;
}

async function tryBookSite(page: Page): Promise<boolean> {
  const bookSelectors = [
    'button:has-text("Add to Stay")',
    'button:has-text("Book Now")',
    'button:has-text("Reserve")',
    'button:has-text("Add to Cart")',
    'button:has-text("Confirm")',
    'button[class*="book"]',
    'button[class*="reserve"]',
  ];

  for (const selector of bookSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible().catch(() => false)) {
      logger.info("Clicking: %s", selector);
      await btn.click();
      await page.waitForTimeout(2000);
      return true;
    }
  }

  return false;
}
