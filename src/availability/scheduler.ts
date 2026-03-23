import cron from "node-cron";
import { checkAvailability, findCampgrounds } from "./checker.js";
import { NotificationManager } from "../notifications/manager.js";
import {
  getNextReleaseDate,
  formatDate,
  msUntilNext7am,
  nowPacific,
} from "../utils/dates.js";
import { sleep } from "../utils/sleep.js";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../config/index.js";
import { PACIFIC_TIMEZONE } from "../config/constants.js";
import type { Campground } from "../types/park.js";

export interface MorningSchedulerOptions {
  parkName: string;
  partySize?: number;
  nights?: number;
  preCheckSeconds?: number;
}

/**
 * Schedule an aggressive availability check at 7 AM Pacific,
 * targeting the newly released date (today + 3 months).
 *
 * Strategy:
 * 1. Start checking a few seconds before 7 AM
 * 2. Check every 2 seconds for the first 60 seconds after 7 AM
 * 3. Notify immediately when availability is found
 */
export async function scheduleMorningCheck(
  options: MorningSchedulerOptions,
): Promise<void> {
  const config = loadConfig();
  const {
    parkName,
    partySize = config.defaultPartySize,
    nights = 1,
    preCheckSeconds = config.morningPreCheckSeconds,
  } = options;

  const notifier = new NotificationManager();

  // Resolve campgrounds once
  const campgrounds = await findCampgrounds(parkName);
  if (campgrounds.length === 0) {
    logger.error('No campgrounds found matching "%s"', parkName);
    return;
  }

  logger.info(
    'Morning scheduler armed for "%s" (%d campgrounds)',
    parkName,
    campgrounds.length,
  );

  // Schedule cron job for 6:59:55 AM Pacific (5 seconds before release)
  const cronMinute = 59;
  const cronHour = 6;
  const cronSecond = 60 - preCheckSeconds;

  // Use cron for daily scheduling
  const task = cron.schedule(
    `${cronSecond} ${cronMinute} ${cronHour} * * *`,
    async () => {
      await runMorningBlitz(campgrounds, {
        partySize,
        nights,
        notifier,
        preCheckSeconds,
      });
    },
    {
      timezone: PACIFIC_TIMEZONE,
    },
  );

  const msUntil = msUntilNext7am();
  const hoursUntil = (msUntil / 3600000).toFixed(1);
  logger.info(
    "Next 7 AM Pacific is in %s hours. Waiting...",
    hoursUntil,
  );
  logger.info("Press Ctrl+C to stop");

  // Keep process alive
  process.on("SIGINT", () => {
    logger.info("Stopping morning scheduler...");
    task.stop();
    process.exit(0);
  });
}

/**
 * Execute the morning blitz: aggressive checking around 7 AM.
 */
async function runMorningBlitz(
  campgrounds: Campground[],
  options: {
    partySize: number;
    nights: number;
    notifier: NotificationManager;
    preCheckSeconds: number;
  },
): Promise<void> {
  const releaseDate = getNextReleaseDate();
  const endDate = new Date(releaseDate);
  endDate.setDate(endDate.getDate() + options.nights);

  logger.info(
    "MORNING BLITZ starting for release date %s",
    formatDate(releaseDate),
  );

  // Aggressive checking: every 2 seconds for 90 seconds
  const maxAttempts = 45;
  const intervalMs = 2000;
  let found = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const now = nowPacific();
    logger.info(
      "Blitz attempt %d/%d at %s",
      attempt,
      maxAttempts,
      now.toLocaleTimeString(),
    );

    for (const campground of campgrounds) {
      try {
        const sites = await checkAvailability({
          campground,
          startDate: releaseDate,
          endDate,
          partySize: options.partySize,
        });

        if (sites.length > 0) {
          found = true;
          const bookingUrls = [...new Set(sites.map((s) => s.bookingUrl))];

          logger.info(
            "FOUND %d sites at %s!",
            sites.length,
            campground.name,
          );

          await options.notifier.notify({
            title: `MORNING RELEASE: ${sites.length} sites at ${campground.name}!`,
            message: `New date ${formatDate(releaseDate)} just released! Book NOW!`,
            sites,
            bookingUrls,
            parkName: campground.name,
            startDate: formatDate(releaseDate),
            endDate: formatDate(endDate),
          });
        }
      } catch (error) {
        logger.error(
          { error, campground: campground.name },
          "Blitz check failed",
        );
      }
    }

    if (found) {
      logger.info("Availability found! Continuing to monitor for 30 more seconds...");
      // Continue checking for a bit in case more sites appear
      await sleep(30000);
      break;
    }

    await sleep(intervalMs);
  }

  if (!found) {
    logger.warn(
      "Morning blitz complete - no availability found for %s",
      formatDate(releaseDate),
    );
  }
}

/**
 * Run a one-time morning blitz immediately (for testing or manual trigger).
 */
export async function runImmediateBlitz(
  options: MorningSchedulerOptions,
): Promise<void> {
  const config = loadConfig();
  const {
    parkName,
    partySize = config.defaultPartySize,
    nights = 1,
  } = options;

  const notifier = new NotificationManager();
  const campgrounds = await findCampgrounds(parkName);

  if (campgrounds.length === 0) {
    logger.error('No campgrounds found matching "%s"', parkName);
    return;
  }

  await runMorningBlitz(campgrounds, {
    partySize,
    nights,
    notifier,
    preCheckSeconds: 0,
  });
}
