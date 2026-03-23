import { describe, it, expect } from "vitest";
import {
  formatDate,
  parseDate,
  formatDateForApi,
  getMaxBookableDate,
  getNextReleaseDate,
  getNext7amPacific,
  msUntilNext7am,
} from "../../src/utils/dates.js";

describe("dates utils", () => {
  describe("formatDate", () => {
    it("formats date as yyyy-MM-dd", () => {
      const date = new Date(2026, 6, 15); // July 15, 2026
      expect(formatDate(date)).toBe("2026-07-15");
    });

    it("pads single-digit months and days", () => {
      const date = new Date(2026, 0, 5); // Jan 5, 2026
      expect(formatDate(date)).toBe("2026-01-05");
    });
  });

  describe("parseDate", () => {
    it("parses yyyy-MM-dd string to Date", () => {
      const date = parseDate("2026-07-15");
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(6); // 0-indexed
      expect(date.getDate()).toBe(15);
    });

    it("round-trips with formatDate", () => {
      const original = "2026-12-25";
      expect(formatDate(parseDate(original))).toBe(original);
    });
  });

  describe("formatDateForApi", () => {
    it("returns ISO string", () => {
      const date = new Date("2026-07-15T00:00:00Z");
      const result = formatDateForApi(date);
      expect(result).toContain("2026-07-15");
      expect(result).toContain("T");
    });
  });

  describe("getMaxBookableDate", () => {
    it("returns a date approximately 3 months from now", () => {
      const max = getMaxBookableDate();
      const now = new Date();
      const diffMs = max.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      // Should be roughly 89-93 days (3 months)
      expect(diffDays).toBeGreaterThan(80);
      expect(diffDays).toBeLessThan(100);
    });
  });

  describe("getNextReleaseDate", () => {
    it("returns a date approximately 3 months + 1 day from now", () => {
      const release = getNextReleaseDate();
      const max = getMaxBookableDate();
      const diffMs = release.getTime() - max.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      // Should be about 1 day after max bookable date
      expect(diffDays).toBeGreaterThanOrEqual(0);
      expect(diffDays).toBeLessThanOrEqual(2);
    });
  });

  describe("getNext7amPacific", () => {
    it("returns a future date", () => {
      const next7am = getNext7amPacific();
      // The returned time should be in the future or very close to now
      expect(next7am.getTime()).toBeGreaterThan(Date.now() - 1000);
    });
  });

  describe("msUntilNext7am", () => {
    it("returns positive number of milliseconds", () => {
      const ms = msUntilNext7am();
      expect(ms).toBeGreaterThan(0);
      // Should be less than 24 hours
      expect(ms).toBeLessThan(24 * 60 * 60 * 1000 + 1000);
    });
  });
});
