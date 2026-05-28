import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { checkAvailability, findCampgrounds } from "./checker.js";
import { NotificationManager } from "../notifications/manager.js";
import { loadConfig } from "../config/index.js";
import { formatDate, getReleaseTime } from "../utils/dates.js";
import { PACIFIC_TIMEZONE } from "../config/constants.js";
import { sleep } from "../utils/sleep.js";
import { logger } from "../utils/logger.js";
import { automateBooking, trySelectSite, tryBookSite } from "../booking/playwright-booker.js";
import { loginToBCParks } from "../booking/login.js";
import { buildSimpleBookingUrl } from "../booking/url-builder.js";
import type { AvailableSite } from "../types/availability.js";
import type { Campground } from "../types/park.js";

export interface MonitorOptions {
  parkName: string;
  startDate: Date;
  endDate: Date;
  partySize?: number;
  intervalSeconds?: number;
  maxChecks?: number;
  autoCart?: boolean;
  signal?: AbortSignal;
  controller?: AbortController;
  preWarmMinutes?: number;
}

/**
 * Continuously monitor availability and notify on changes.
 * Tracks previously-seen sites to only alert on *new* availability.
 * When autoCart is enabled, launches Playwright to auto-add to cart.
 * If the release time is in the future, pre-warms the browser before release
 * so the booking page is already loaded when sites appear.
 */
export async function startMonitor(options: MonitorOptions): Promise<void> {
  const config = loadConfig();
  const {
    parkName,
    startDate,
    endDate,
    partySize = config.defaultPartySize,
    intervalSeconds = config.monitorIntervalSeconds,
    maxChecks = 0,
    autoCart = config.autoCartEnabled,
    preWarmMinutes = config.autoCartPreWarmMinutes,
    signal,
  } = options;

  const notifier = new NotificationManager();

  if (signal?.aborted) return;

  const campgrounds = await findCampgrounds(parkName);
  if (campgrounds.length === 0) {
    logger.error('No campgrounds found matching "%s"', parkName);
    return;
  }

  const releaseTime = getReleaseTime(startDate);
  const msToRelease = releaseTime.getTime() - Date.now();

  // Pre-warm browser if autoCart enabled and release is in the future
  let preWarmedBrowser: Browser | null = null;
  let preWarmedContext: BrowserContext | null = null;
  let preWarmedPage: Page | null = null;

  if (autoCart && msToRelease > 0 && preWarmMinutes > 0) {
    const preWarmMs = preWarmMinutes * 60 * 1000;
    const msToPreWarm = Math.max(0, msToRelease - preWarmMs);

    if (msToPreWarm > 0) {
      const releasePacific = toZonedTime(releaseTime, PACIFIC_TIMEZONE);
      logger.info(
        "Pre-warming browser %d min before release at %s Pacific...",
        preWarmMinutes,
        format(releasePacific, "yyyy-MM-dd HH:mm:ss"),
      );
      await sleep(msToPreWarm);
    }

    try {
      logger.info("Launching pre-warmed browser...");
      preWarmedBrowser = await chromium.launch({
        headless: config.autoCartHeadless,
        args: ["--disable-blink-features=AutomationControlled"],
      });
      preWarmedContext = await preWarmedBrowser.newContext({
        locale: "en-US",
        timezoneId: "America/Vancouver",
        viewport: { width: 1440, height: 900 },
      });
      preWarmedPage = await preWarmedContext.newPage();

      const loginResult = await loginToBCParks();
      if (loginResult) {
        await preWarmedContext.addCookies(loginResult.cookies);
      }

      // Pre-navigate to warm up session and cookies
      const first = campgrounds[0];
      const warmupUrl = buildSimpleBookingUrl({
        mapId: first.mapId,
        resourceLocationId: first.id,
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        partySize,
      });
      await preWarmedPage.goto(warmupUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
        .catch(() => logger.warn("Pre-warm navigation timed out, continuing..."));

      if (!config.autoCartHeadless) {
        logger.info("Pre-warmed browser is ready — will use it when sites are found");
      }

      // Sleep remaining time until release
      const remainingMs = releaseTime.getTime() - Date.now();
      if (remainingMs > 0) {
        await sleep(remainingMs);
      }
    } catch (error) {
      logger.warn({ error }, "Browser pre-warm failed, falling back to on-demand launch");
      if (preWarmedBrowser) await preWarmedBrowser.close().catch(() => {});
      preWarmedBrowser = null;
      preWarmedContext = null;
      preWarmedPage = null;
    }
  } else if (msToRelease > 0) {
    const releasePacific = toZonedTime(releaseTime, PACIFIC_TIMEZONE);
    const timeStr = `${format(releasePacific, "yyyy-MM-dd HH:mm:ss")} Pacific`;
    logger.info(
      "Waiting for release on %s (%d seconds from now)...",
      timeStr,
      Math.round(msToRelease / 1000),
    );
    if (signal?.aborted) return;
    await sleep(msToRelease);
  }

  logger.info(
    "Monitoring %d campgrounds for %s to %s (every %ds, auto-cart=%s)",
    campgrounds.length,
    formatDate(startDate),
    formatDate(endDate),
    intervalSeconds,
    autoCart ? "yes" : "no",
  );

  const previousSites = new Map<number, Set<number>>();
  let cartLaunched = false;
  let checkCount = 0;

  while (maxChecks === 0 || checkCount < maxChecks) {
    if (signal?.aborted) {
      logger.info("Monitor aborted by signal");
      break;
    }
    checkCount++;
    logger.info("Check #%d at %s", checkCount, new Date().toLocaleTimeString());

    for (const campground of campgrounds) {
      try {
        const sites = await checkAvailability({
          campground,
          startDate,
          endDate,
          partySize,
        });

        const prev = previousSites.get(campground.id) ?? new Set();
        const newSites = sites.filter((s) => !prev.has(s.resourceId));

        if (newSites.length > 0) {
          logger.info(
            "%d NEW sites available at %s!",
            newSites.length,
            campground.name,
          );

          const bookingUrls = [
            ...new Set(newSites.map((s) => s.bookingUrl)),
          ];

          await notifier.notify({
            title: `${newSites.length} sites available at ${campground.name}!`,
            message: `New availability found for ${formatDate(startDate)} to ${formatDate(endDate)}`,
            sites: newSites,
            bookingUrls,
            parkName: campground.name,
            startDate: formatDate(startDate),
            endDate: formatDate(endDate),
          });

          if (autoCart && !cartLaunched && bookingUrls.length > 0) {
            cartLaunched = true;

            // Try pre-warmed browser first
            let bookingSuccess = false;
            if (preWarmedPage && preWarmedContext && preWarmedBrowser) {
              logger.info("Auto-cart: using pre-warmed browser...");
              bookingSuccess = await bookWithPreWarmedPage(
                preWarmedPage,
                preWarmedContext,
                bookingUrls[0],
                newSites.map((s) => s.resourceId),
                config.autoCartHeadless,
              );
              // Non-headless + success: bookWithPreWarmedPage blocks forever
              // Headless + success: returns true
              // Failure: returns false
            }

            // Fall back to on-demand if pre-warmed failed or wasn't available
            if (!bookingSuccess) {
              logger.info("Auto-cart: launching on-demand Playwright...");
              const result = await automateBooking({
                bookingUrl: bookingUrls[0],
                headless: config.autoCartHeadless,
                resourceIds: newSites.map((s) => s.resourceId),
              });
              bookingSuccess = result.success;
            }

            if (bookingSuccess) {
              await notifier.notify({
                title: `✅ Site added to cart at ${campground.name}!`,
                message: `Site added to cart! Complete payment within 15 minutes.\n${bookingUrls[0]}`,
                sites: newSites,
                bookingUrls,
                parkName: campground.name,
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
              });
              logger.info("Site added to cart, stopping monitor");
              options.controller?.abort();
              break;
            } else {
              await notifier.notify({
                title: `❌ Auto-cart failed at ${campground.name}`,
                message: `Could not auto-add: manual booking required.\n${bookingUrls[0]}`,
                sites: newSites,
                bookingUrls,
                parkName: campground.name,
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
              });
            }
          }
        } else if (sites.length > 0) {
          logger.info(
            "%d sites still available at %s (no new ones)",
            sites.length,
            campground.name,
          );
        } else {
          logger.info("No availability at %s", campground.name);
        }

        previousSites.set(
          campground.id,
          new Set(sites.map((s) => s.resourceId)),
        );
      } catch (error) {
        logger.error(
          { error, campground: campground.name },
          "Error checking campground",
        );
      }
    }

    if (signal?.aborted) break;
    if (maxChecks !== 0 && checkCount >= maxChecks) break;

    logger.info("Next check in %d seconds...", intervalSeconds);
    await sleep(intervalSeconds * 1000);
  }

  if (preWarmedBrowser) {
    await preWarmedBrowser.close().catch(() => {});
  }

  logger.info("Monitor finished after %d checks", checkCount);
}

/**
 * Use a pre-warmed browser page to navigate to the booking URL,
 * select an available site, and attempt to book it.
 * On success in non-headless mode, blocks forever to keep the browser open.
 */
async function bookWithPreWarmedPage(
  page: Page,
  _context: BrowserContext,
  bookingUrl: string,
  resourceIds: number[],
  headless: boolean,
): Promise<boolean> {
  try {
    logger.info("Pre-warmed browser: navigating to booking page...");
    await page.goto(bookingUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
      .catch(() => logger.warn("Booking page navigation timed out, continuing..."));

    await sleep(2000);

    const siteSelected = await trySelectSite(page, resourceIds);
    if (!siteSelected) {
      logger.warn("Pre-warmed browser: could not auto-select a site");
      return false;
    }

    const booked = await tryBookSite(page);
    if (!booked) {
      logger.warn("Pre-warmed browser: could not auto-book the site");
      return false;
    }

    logger.info("Pre-warmed browser: site added to cart! Complete payment in the browser window.");
    if (!headless) {
      logger.info("Browser will remain open for payment.");
      await new Promise(() => {});
    }
    return true;
  } catch (error) {
    logger.error({ error }, "Pre-warmed browser booking failed");
    return false;
  }
}
