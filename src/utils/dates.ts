import { addMonths, format, parse, startOfDay } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import {
  PACIFIC_TIMEZONE,
  BOOKING_WINDOW_MONTHS,
  RELEASE_HOUR,
} from "../config/constants.js";

export function nowPacific(): Date {
  return toZonedTime(new Date(), PACIFIC_TIMEZONE);
}

export function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function parseDate(dateStr: string): Date {
  return parse(dateStr, "yyyy-MM-dd", new Date());
}

export function formatDateForApi(date: Date): string {
  return date.toISOString();
}

/**
 * Get the furthest bookable date from today (3 months out).
 */
export function getMaxBookableDate(): Date {
  const now = nowPacific();
  return addMonths(startOfDay(now), BOOKING_WINDOW_MONTHS);
}

/**
 * Get the date that will be released tomorrow at 7 AM Pacific.
 * This is today + 3 months + 1 day.
 */
export function getNextReleaseDate(): Date {
  const tomorrow = new Date(nowPacific());
  tomorrow.setDate(tomorrow.getDate() + 1);
  return addMonths(startOfDay(tomorrow), BOOKING_WINDOW_MONTHS);
}

/**
 * Get the next 7 AM Pacific time (today if before 7 AM, tomorrow if after).
 */
export function getNext7amPacific(): Date {
  const now = nowPacific();
  const today7am = startOfDay(now);
  today7am.setHours(RELEASE_HOUR, 0, 0, 0);

  if (now < today7am) {
    return fromZonedTime(today7am, PACIFIC_TIMEZONE);
  }

  const tomorrow7am = new Date(today7am);
  tomorrow7am.setDate(tomorrow7am.getDate() + 1);
  return fromZonedTime(tomorrow7am, PACIFIC_TIMEZONE);
}

export function msUntilNext7am(): number {
  return getNext7amPacific().getTime() - Date.now();
}
