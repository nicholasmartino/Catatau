export interface AvailabilitySearchParams {
  mapId: number;
  resourceLocationId: number;
  bookingCategoryId: number;
  startDate: string;
  endDate: string;
  isReserving: boolean;
  getDailyAvailability: boolean;
  partySize: number;
  numEquipment: number;
  equipmentCategoryId: number;
  filterData: unknown[];
  subEquipmentCategoryId?: number;
}

export interface AvailabilityResponse {
  resourceAvailabilities: Record<string, ResourceAvailability>;
  mapLinkAvailabilities: Record<string, MapLinkAvailability>;
}

export interface ResourceAvailability {
  resourceId: number;
  availability: number; // 0 = available
  bookingCategoryId: number;
  mapId: number;
  resourceLocationLocalizedValues?: { en: string };
}

export interface MapLinkAvailability {
  mapLinkId: number;
  availability: number;
  childMapId: number;
}

export interface AvailableSite {
  resourceId: number;
  mapId: number;
  resourceLocationId: number;
  campgroundName: string;
  siteName: string;
  bookingUrl: string;
}

export interface DailyAvailability {
  resourceId: number;
  availability: Record<string, number>; // date -> availability code
}

export interface MonitorResult {
  timestamp: Date;
  parkName: string;
  startDate: string;
  endDate: string;
  availableSites: AvailableSite[];
  newSites: AvailableSite[]; // sites that became available since last check
}
