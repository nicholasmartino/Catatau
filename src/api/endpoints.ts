import { API_ENDPOINTS, BCPARKS_BASE_URL } from "../config/constants.js";
import { apiRequest } from "./client.js";
import {
  resourceLocationSchema,
  campgroundMapSchema,
  availabilityResponseSchema,
  equipmentCategorySchema,
  type RawResourceLocation,
  type RawCampgroundMap,
  type RawAvailabilityResponse,
  type RawEquipmentCategory,
} from "./types.js";
import type { AvailabilitySearchParams } from "../types/availability.js";
import { z } from "zod";
import { logger } from "../utils/logger.js";

function buildQueueItUrl(
  params: AvailabilitySearchParams,
  resourceLocationId: number,
  transactionLocationId: number,
): string {
  const nights = Math.round(
    (new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) / (1000 * 60 * 60 * 24),
  );
  const searchTime = new Date().toISOString().replace(/\.\d{3}Z$/, "");

  const url = new URL("/create-booking/results", BCPARKS_BASE_URL);
  url.searchParams.set("transactionLocationId", String(transactionLocationId));
  url.searchParams.set("resourceLocationId", String(resourceLocationId));
  url.searchParams.set("mapId", String(params.mapId));
  url.searchParams.set("searchTabGroupId", "0");
  url.searchParams.set("bookingCategoryId", String(params.bookingCategoryId));
  url.searchParams.set("startDate", params.startDate);
  url.searchParams.set("endDate", params.endDate);
  url.searchParams.set("nights", String(nights));
  url.searchParams.set("isReserving", String(params.isReserving));
  url.searchParams.set("equipmentId", String(params.equipmentCategoryId));
  if (params.subEquipmentCategoryId !== undefined) {
    url.searchParams.set("subEquipmentId", String(params.subEquipmentCategoryId));
  }
  url.searchParams.set("searchTime", searchTime);
  url.searchParams.set("flexibleSearch", `[false,false,"${params.startDate}",1]`);

  return encodeURIComponent(url.toString());
}

/**
 * List all campground/resource locations in BC Parks.
 */
export async function listCampgrounds(): Promise<RawResourceLocation[]> {
  const data = await apiRequest<unknown[]>(API_ENDPOINTS.LIST_CAMPGROUNDS);
  return z.array(resourceLocationSchema).parse(data);
}

/**
 * Get map details for a specific resource location.
 */
export async function getMaps(
  resourceLocationId?: number,
): Promise<RawCampgroundMap[]> {
  const params: Record<string, string | number | boolean> = {};
  if (resourceLocationId !== undefined) {
    params.resourceLocationId = resourceLocationId;
  }
  const data = await apiRequest<unknown[]>(API_ENDPOINTS.CAMP_DETAILS, {
    params,
  });
  return z.array(campgroundMapSchema).parse(data);
}

/**
 * Search for availability using the map availability endpoint.
 * This is the primary availability search method.
 */
export async function searchAvailability(
  searchParams: AvailabilitySearchParams,
  resourceLocationId: number,
  transactionLocationId: number,
): Promise<RawAvailabilityResponse> {
  const data = await apiRequest<unknown>(API_ENDPOINTS.MAP_AVAILABILITY, {
    method: "GET",
    params: searchParams as unknown as Record<string, string | number | boolean>,
    headers: {
      "app-language": "en-CA",
      "app-version": "5.109.174",
      "x-queueit-ajaxpageurl": buildQueueItUrl(searchParams, resourceLocationId, transactionLocationId),
    },
  });
  return availabilityResponseSchema.parse(data);
}

/**
 * Get daily availability for a specific resource.
 */
export async function getDailyAvailability(params: {
  resourceLocationId: number;
  mapId: number;
  startDate: string;
  endDate: string;
}): Promise<unknown> {
  return apiRequest(API_ENDPOINTS.DAILY_AVAILABILITY, {
    params: {
      resourceLocationId: params.resourceLocationId,
      mapId: params.mapId,
      startDate: params.startDate,
      endDate: params.endDate,
    },
  });
}

/**
 * List all equipment categories (tent, RV, trailer, etc.).
 */
export async function listEquipment(): Promise<RawEquipmentCategory[]> {
  const data = await apiRequest<unknown[]>(API_ENDPOINTS.LIST_EQUIPMENT);
  return z.array(equipmentCategorySchema).parse(data);
}

/**
 * Get details about a specific resource/site.
 */
export async function getSiteDetails(resourceId: number): Promise<unknown> {
  return apiRequest(API_ENDPOINTS.SITE_DETAILS, {
    params: { resourceId },
  });
}

/**
 * Get resource categories.
 */
export async function getResourceCategories(): Promise<unknown> {
  return apiRequest(API_ENDPOINTS.RESOURCE_CATEGORY);
}

/**
 * Get filterable attributes.
 */
export async function getFilterableAttributes(): Promise<unknown> {
  return apiRequest(API_ENDPOINTS.FILTERABLE_ATTRIBUTES);
}
