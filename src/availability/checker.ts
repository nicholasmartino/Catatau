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
import { formatDateForApi, formatDate } from "../utils/dates.js";
import { logger } from "../utils/logger.js";
import type {
  AvailableSite,
  AvailabilitySearchParams,
} from "../types/availability.js";
import type { Campground } from "../types/park.js";

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
      const name = loc.resourceLocationLocalizedValues.en.toLowerCase();
      return name.includes(term);
    })
    .filter((loc) =>
      loc.resourceCategoryIds.some((id) => RESERVABLE_CATEGORY_IDS.has(id)),
    )
    .map((loc) => ({
      id: loc.resourceLocationId,
      name: loc.resourceLocationLocalizedValues.en,
      mapId: loc.mapId,
      regionId: loc.regionId,
      resourceCategoryIds: loc.resourceCategoryIds,
      hasAlerts: loc.hasAlerts,
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
      name: loc.resourceLocationLocalizedValues.en,
      mapId: loc.mapId,
      regionId: loc.regionId,
      resourceCategoryIds: loc.resourceCategoryIds,
      hasAlerts: loc.hasAlerts,
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
    subEquipmentCategoryId,
  } = options;

  // Get maps for this campground to find mapId
  const maps = await getMaps(campground.id);
  if (maps.length === 0) {
    logger.warn("No maps found for campground %s", campground.name);
    return [];
  }

  const rootMapId = maps[0].mapId;
  const availableSites: AvailableSite[] = [];

  // Recursive search through map hierarchy
  const visited = new Set<number>();

  async function searchMap(mapId: number): Promise<void> {
    if (visited.has(mapId)) return;
    visited.add(mapId);

    const searchParams: AvailabilitySearchParams = {
      mapId,
      resourceLocationId: campground.id,
      bookingCategoryId: 0,
      startDate: formatDateForApi(startDate),
      endDate: formatDateForApi(endDate),
      isReserving: true,
      getDailyAvailability: false,
      partySize,
      numEquipment: 1,
      equipmentCategoryId,
      filterData: [],
      ...(subEquipmentCategoryId !== undefined && {
        subEquipmentCategoryId,
      }),
    };

    logger.debug(
      "Searching map %d for campground %s",
      mapId,
      campground.name,
    );

    try {
      const response = await searchAvailability(searchParams);

      // Process direct resource availabilities
      for (const [key, resource] of Object.entries(
        response.resourceAvailabilities,
      )) {
        if (resource.availability === 0) {
          availableSites.push({
            resourceId: resource.resourceId,
            mapId,
            resourceLocationId: campground.id,
            campgroundName: campground.name,
            siteName: `Site ${resource.resourceId}`,
            bookingUrl: buildBookingUrl({
              mapId,
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

      // Follow map links recursively
      for (const [key, link] of Object.entries(
        response.mapLinkAvailabilities,
      )) {
        if (link.childMapId && link.availability === 0) {
          await searchMap(link.childMapId);
        }
      }
    } catch (error) {
      logger.error(
        { error, mapId, campground: campground.name },
        "Failed to search map",
      );
    }
  }

  await searchMap(rootMapId);

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
