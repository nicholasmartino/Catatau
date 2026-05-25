import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { checkAvailability, findCampgrounds } from "./checker.js";
import { NotificationManager } from "../notifications/manager.js";
import { loadConfig } from "../config/index.js";
import { formatDate, getReleaseTime } from "../utils/dates.js";
import { PACIFIC_TIMEZONE } from "../config/constants.js";
import { sleep } from "../utils/sleep.js";
import { logger } from "../utils/logger.js";
import { automateBooking } from "../booking/playwright-booker.js";
import type { AvailableSite } from "../types/availability.js";
import type { Campground } from "../types/park.js";

export interface MonitorOptions {
  parkName: string;
  startDate: Date;
  endDate: Date;
  partySize?: number;
  intervalSeconds?: number;
  maxChecks?: number; // 0 = unlimited
  autoCart?: boolean; // auto-add to cart via Playwright
  signal?: AbortSignal; // optional abort signal for cancellation
  controller?: AbortController; // allows monitor to self-abort after cart success
}

/**
 * Continuously monitor availability and notify on changes.
 * Tracks previously-seen sites to only alert on *new* availability.
 * When autoCart is enabled, launches Playwright to auto-add to cart.
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
    signal,
  } = options;

  const notifier = new NotificationManager();

  if (signal?.aborted) return;

  // Resolve campgrounds once
  const campgrounds = await findCampgrounds(parkName);
  if (campgrounds.length === 0) {
    logger.error('No campgrounds found matching "%s"', parkName);
    return;
  }

  const releaseTime = getReleaseTime(startDate);
  const msToRelease = releaseTime.getTime() - Date.now();

  if (msToRelease > 0) {
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

  // Track previously seen available site IDs per campground
  const previousSites = new Map<number, Set<number>>();
  let cartLaunched = false;

  let checkCount = 0;

  while (maxChecks === 0 || checkCount < maxChecks) {
    if (signal?.aborted) {
      logger.info("Monitor aborted by signal");
      break;
    }
    checkCount++;
    logger.info(
      "Check #%d at %s",
      checkCount,
      new Date().toLocaleTimeString(),
    );

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

          // Auto-add to cart via Playwright if enabled and not already launched
          if (autoCart && !cartLaunched && bookingUrls.length > 0) {
            cartLaunched = true;
            logger.info("Auto-cart: launching Playwright to add site to cart...");
            const result = await automateBooking({
              bookingUrl: bookingUrls[0],
              headless: config.autoCartHeadless,
              resourceIds: newSites.map((s) => s.resourceId),
            });

            await notifier.notify({
              title: result.success
                ? `✅ Site added to cart at ${campground.name}!`
                : `❌ Auto-cart failed at ${campground.name}`,
              message: result.success
                ? `Site added to cart! Complete payment within 15 minutes.\n${bookingUrls[0]}`
                : `Could not auto-add: ${result.message}`,
              sites: newSites,
              bookingUrls,
              parkName: campground.name,
              startDate: formatDate(startDate),
              endDate: formatDate(endDate),
            });

            if (result.success) {
              logger.info("Site added to cart, stopping monitor");
              options.controller?.abort();
              break;
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

        // Update tracking
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

  logger.info("Monitor finished after %d checks", checkCount);
}
