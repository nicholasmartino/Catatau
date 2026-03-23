import { BCPARKS_BASE_URL } from "../config/constants.js";
import { formatDate } from "../utils/dates.js";

export interface BookingUrlParams {
  mapId: number;
  resourceLocationId: number;
  startDate: Date;
  endDate: Date;
  partySize: number;
  equipmentCategoryId: number;
  subEquipmentCategoryId?: number;
}

/**
 * Generate a direct booking URL that opens the BC Parks booking page
 * with all parameters pre-filled.
 */
export function buildBookingUrl(params: BookingUrlParams): string {
  const url = new URL("/create-booking/results", BCPARKS_BASE_URL);
  url.searchParams.set("mapId", String(params.mapId));
  url.searchParams.set("bookingCategoryId", "0");
  url.searchParams.set("startDate", formatDate(params.startDate));
  url.searchParams.set("endDate", formatDate(params.endDate));
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
 * Generate a booking URL from simple parameters (for CLI convenience).
 */
export function buildSimpleBookingUrl(params: {
  mapId: number;
  resourceLocationId: number;
  startDate: string; // yyyy-MM-dd
  endDate: string;
  partySize?: number;
}): string {
  const url = new URL("/create-booking/results", BCPARKS_BASE_URL);
  url.searchParams.set("mapId", String(params.mapId));
  url.searchParams.set("bookingCategoryId", "0");
  url.searchParams.set("startDate", params.startDate);
  url.searchParams.set("endDate", params.endDate);
  url.searchParams.set("isReserving", "true");
  url.searchParams.set("equipmentId", "-32768");
  url.searchParams.set("partySize", String(params.partySize ?? 2));
  url.searchParams.set(
    "resourceLocationId",
    String(params.resourceLocationId),
  );
  return url.toString();
}
