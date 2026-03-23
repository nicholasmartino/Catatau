import { describe, it, expect } from "vitest";
import {
  BCPARKS_BASE_URL,
  API_ENDPOINTS,
  RESOURCE_CATEGORIES,
  EQUIPMENT_CATEGORIES,
  RESERVABLE_CATEGORY_IDS,
  BOOKING_WINDOW_MONTHS,
  MAX_CONSECUTIVE_NIGHTS,
  PACIFIC_TIMEZONE,
  RELEASE_HOUR,
} from "../../src/config/constants.js";

describe("constants", () => {
  it("has correct base URL", () => {
    expect(BCPARKS_BASE_URL).toBe("https://camping.bcparks.ca");
  });

  it("has all required API endpoints", () => {
    expect(API_ENDPOINTS.LIST_CAMPGROUNDS).toBe("/api/resourceLocation");
    expect(API_ENDPOINTS.CAMP_DETAILS).toBe("/api/maps");
    expect(API_ENDPOINTS.MAP_AVAILABILITY).toBe("/api/availability/map");
    expect(API_ENDPOINTS.LIST_EQUIPMENT).toBe("/api/equipment");
    expect(API_ENDPOINTS.SITE_DETAILS).toBe("/api/resource/details");
  });

  it("has correct resource category IDs", () => {
    expect(RESOURCE_CATEGORIES.CAMP_SITE).toBe(-2147483648);
    expect(RESOURCE_CATEGORIES.OVERFLOW_SITE).toBe(-2147483647);
    expect(RESOURCE_CATEGORIES.GROUP_SITE).toBe(-2147483643);
  });

  it("RESERVABLE_CATEGORY_IDS includes all camping categories", () => {
    expect(RESERVABLE_CATEGORY_IDS.has(RESOURCE_CATEGORIES.CAMP_SITE)).toBe(true);
    expect(RESERVABLE_CATEGORY_IDS.has(RESOURCE_CATEGORIES.OVERFLOW_SITE)).toBe(true);
    expect(RESERVABLE_CATEGORY_IDS.has(RESOURCE_CATEGORIES.GROUP_SITE)).toBe(true);
    expect(RESERVABLE_CATEGORY_IDS.has(99)).toBe(false);
  });

  it("has correct booking parameters", () => {
    expect(BOOKING_WINDOW_MONTHS).toBe(3);
    expect(MAX_CONSECUTIVE_NIGHTS).toBe(14);
    expect(PACIFIC_TIMEZONE).toBe("America/Vancouver");
    expect(RELEASE_HOUR).toBe(7);
    expect(EQUIPMENT_CATEGORIES.NON_GROUP_EQUIPMENT).toBe(-32768);
  });
});
