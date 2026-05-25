import { randomUUID } from "node:crypto";
import {
  listCampgrounds,
  getMaps,
  searchAvailability,
} from "../api/endpoints.js";
import {
  RESERVABLE_CATEGORY_IDS,
  EQUIPMENT_CATEGORIES,
  BCPARKS_BASE_URL,
} from "../config/constants.js";
import { loadConfig } from "../config/index.js";
import { formatDate } from "../utils/dates.js";
import { logger } from "../utils/logger.js";
import type {
  AvailableSite,
  AvailabilitySearchParams,
} from "../types/availability.js";
import type { Campground } from "../types/park.js";

function getEnglishName(loc: { localizedValues: Array<{ cultureName: string; shortName: string }> }): string {
  return loc.localizedValues.find((lv) => lv.cultureName === "en-CA")?.shortName ?? "Unknown";
}

/**
 * Find campgrounds matching a search term.
 */
export async function findCampgrounds(
  searchTerm: string,
): Promise<Campground[]> {
  const locations = await listCampgrounds();
  const term = searchTerm.toLowerCase();

  return locations
    .filter((loc) => {
      const name = getEnglishName(loc).toLowerCase();
      return name.includes(term) || term.includes(name);
    })
    .filter((loc) =>
      loc.resourceCategoryIds.some((id) => RESERVABLE_CATEGORY_IDS.has(id)),
    )
    .map((loc) => ({
      id: loc.resourceLocationId,
      name: getEnglishName(loc),
      mapId: loc.rootMapId,
      regionId: 0,
      resourceCategoryIds: loc.resourceCategoryIds,
      hasAlerts: false,
    }));
}

/**
 * List all reservable campgrounds.
 */
export async function listAllCampgrounds(): Promise<Campground[]> {
  const locations = await listCampgrounds();

  return locations
    .filter((loc) =>
      loc.resourceCategoryIds.some((id) => RESERVABLE_CATEGORY_IDS.has(id)),
    )
    .map((loc) => ({
      id: loc.resourceLocationId,
      name: getEnglishName(loc),
      mapId: loc.rootMapId,
      regionId: 0,
      resourceCategoryIds: loc.resourceCategoryIds,
      hasAlerts: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build a booking URL for a specific site.
 */
function buildBookingUrl(params: {
  mapId: number;
  startDate: string;
  endDate: string;
  equipmentCategoryId: number;
  subEquipmentCategoryId?: number;
  partySize: number;
  resourceLocationId: number;
}): string {
  const url = new URL("/create-booking/results", BCPARKS_BASE_URL);
  url.searchParams.set("mapId", String(params.mapId));
  url.searchParams.set("bookingCategoryId", "0");
  url.searchParams.set("startDate", params.startDate);
  url.searchParams.set("endDate", params.endDate);
  url.searchParams.set("isReserving", "true");
  url.searchParams.set("equipmentId", String(params.equipmentCategoryId));
  if (params.subEquipmentCategoryId !== undefined) {
    url.searchParams.set(
      "subEquipmentId",
      String(params.subEquipmentCategoryId),
    );
  }
  url.searchParams.set("partySize", String(params.partySize));
  url.searchParams.set(
    "resourceLocationId",
    String(params.resourceLocationId),
  );
  return url.toString();
}

/**
 * Check availability for a campground, following nested map links recursively.
 */
export async function checkAvailability(options: {
  campground: Campground;
  startDate: Date;
  endDate: Date;
  partySize?: number;
  equipmentCategoryId?: number;
  subEquipmentCategoryId?: number;
}): Promise<AvailableSite[]> {
  const config = loadConfig();
  const {
    campground,
    startDate,
    endDate,
    partySize = config.defaultPartySize,
    equipmentCategoryId = EQUIPMENT_CATEGORIES.NON_GROUP_EQUIPMENT,
    subEquipmentCategoryId = EQUIPMENT_CATEGORIES.NON_GROUP_SUB_EQUIPMENT,
  } = options;

  // Get maps for this campground to find mapId
  const maps = await getMaps(campground.id);
  if (maps.length === 0) {
    logger.warn("No maps found for campground %s", campground.name);
    return [];
  }

  const transactionLocationId = maps
    .find(m => m.mapLinks?.length > 0)
    ?.mapLinks?.[0]?.transactionLocationId ?? 0;
  const availableSites: AvailableSite[] = [];

  for (const map of maps) {
    const searchParams: AvailabilitySearchParams = {
      mapId: map.mapId,
      bookingCategoryId: 0,
      equipmentCategoryId,
      subEquipmentCategoryId,
      cartUid: randomUUID(),
      cartTransactionUid: randomUUID(),
      bookingUid: randomUUID(),
      groupHoldUid: "",
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      getDailyAvailability: false,
      isReserving: true,
      filterData: "[]",
      boatLength: 0,
      boatDraft: 0,
      boatWidth: 0,
      peopleCapacityCategoryCounts: "[]",
      numEquipment: 0,
      seed: new Date().toISOString(),
    };

    logger.debug(
      "Searching map %d for campground %s",
      map.mapId,
      campground.name,
    );

    try {
      const response = await searchAvailability(
        searchParams,
        campground.id,
        transactionLocationId,
      );

      for (const [key, availabilities] of Object.entries(
        response.resourceAvailabilities,
      )) {
        if (availabilities[0]?.availability === 0) {
          availableSites.push({
            resourceId: parseInt(key),
            mapId: map.mapId,
            resourceLocationId: campground.id,
            campgroundName: campground.name,
            siteName: `Site ${key}`,
            bookingUrl: buildBookingUrl({
              mapId: map.mapId,
              startDate: formatDate(startDate),
              endDate: formatDate(endDate),
              equipmentCategoryId,
              subEquipmentCategoryId,
              partySize,
              resourceLocationId: campground.id,
            }),
          });
        }
      }
    } catch (error) {
      logger.error(
        { err: error, mapId: map.mapId, campground: campground.name },
        "Failed to search map",
      );
    }
  }

  logger.info(
    "Found %d available sites at %s (%s to %s)",
    availableSites.length,
    campground.name,
    formatDate(startDate),
    formatDate(endDate),
  );

  return availableSites;
}

/**
 * Quick check: search for a campground by name and check availability.
 */
export async function quickCheck(options: {
  parkName: string;
  startDate: Date;
  endDate: Date;
  partySize?: number;
}): Promise<{ campground: Campground; sites: AvailableSite[] }[]> {
  const campgrounds = await findCampgrounds(options.parkName);

  if (campgrounds.length === 0) {
    logger.warn('No campgrounds found matching "%s"', options.parkName);
    return [];
  }

  logger.info(
    'Found %d campgrounds matching "%s"',
    campgrounds.length,
    options.parkName,
  );

  const results: { campground: Campground; sites: AvailableSite[] }[] = [];

  for (const campground of campgrounds) {
    const sites = await checkAvailability({
      campground,
      startDate: options.startDate,
      endDate: options.endDate,
      partySize: options.partySize,
    });

    results.push({ campground, sites });
  }

  return results;
}
