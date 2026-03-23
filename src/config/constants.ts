export const BCPARKS_BASE_URL = "https://camping.bcparks.ca";

export const API_ENDPOINTS = {
  LIST_CAMPGROUNDS: "/api/resourceLocation",
  CAMP_DETAILS: "/api/maps",
  MAP_AVAILABILITY: "/api/availability/map",
  DAILY_AVAILABILITY: "/api/availability/resourcedailyavailability",
  RESOURCE_STATUS: "/api/availability/resourcestatus",
  RESOURCE_CATEGORY: "/api/resourcecategory",
  LIST_EQUIPMENT: "/api/equipment",
  SITE_DETAILS: "/api/resource/details",
  FILTERABLE_ATTRIBUTES: "/api/attribute/filterable",
} as const;

export const RESOURCE_CATEGORIES = {
  CAMP_SITE: -2147483648,
  OVERFLOW_SITE: -2147483647,
  GROUP_SITE: -2147483643,
} as const;

export const EQUIPMENT_CATEGORIES = {
  NON_GROUP_EQUIPMENT: -32768,
} as const;

export const RESERVABLE_CATEGORY_IDS = new Set<number>([
  RESOURCE_CATEGORIES.CAMP_SITE,
  RESOURCE_CATEGORIES.OVERFLOW_SITE,
  RESOURCE_CATEGORIES.GROUP_SITE,
]);

export const BOOKING_WINDOW_MONTHS = 3;
export const MAX_CONSECUTIVE_NIGHTS = 14;
export const RESERVATION_HOLD_MINUTES = 15;
export const PACIFIC_TIMEZONE = "America/Vancouver";
export const RELEASE_HOUR = 7; // 7:00 AM Pacific
