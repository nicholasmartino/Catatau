import { checkAvailability, findCampgrounds } from "./checker.js";
import { NotificationManager } from "../notifications/manager.js";
import { loadConfig } from "../config/index.js";
import { formatDate } from "../utils/dates.js";
import { sleep } from "../utils/sleep.js";
import { logger } from "../utils/logger.js";
import type { AvailableSite } from "../types/availability.js";
import type { Campground } from "../types/park.js";

export interface MonitorOptions {
  parkName: string;
  startDate: Date;
  endDate: Date;
  partySize?: number;
  intervalSeconds?: number;
  maxChecks?: number; // 0 = unlimited
}

/**
 * Continuously monitor availability and notify on changes.
 * Tracks previously-seen sites to only alert on *new* availability.
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
  } = options;

  const notifier = new NotificationManager();

  // Resolve campgrounds once
  const campgrounds = await findCampgrounds(parkName);
  if (campgrounds.length === 0) {
    logger.error('No campgrounds found matching "%s"', parkName);
    return;
  }

  logger.info(
    "Monitoring %d campgrounds for %s to %s (every %ds)",
    campgrounds.length,
    formatDate(startDate),
    formatDate(endDate),
    intervalSeconds,
  );

  // Track previously seen available site IDs per campground
  const previousSites = new Map<number, Set<number>>();

  let checkCount = 0;

  while (maxChecks === 0 || checkCount < maxChecks) {
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

          // Get unique booking URLs
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

    if (maxChecks !== 0 && checkCount >= maxChecks) break;

    logger.info("Next check in %d seconds...", intervalSeconds);
    await sleep(intervalSeconds * 1000);
  }

  logger.info("Monitor finished after %d checks", checkCount);
}
