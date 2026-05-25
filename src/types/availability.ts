export interface AvailabilitySearchParams {
  mapId: number;
  bookingCategoryId: number;
  equipmentCategoryId: number;
  subEquipmentCategoryId?: number;
  cartUid: string;
  cartTransactionUid: string;
  bookingUid: string;
  groupHoldUid: string;
  startDate: string;
  endDate: string;
  getDailyAvailability: boolean;
  isReserving: boolean;
  filterData: string;
  boatLength: number;
  boatDraft: number;
  boatWidth: number;
  peopleCapacityCategoryCounts: string;
  numEquipment: number;
  seed: string;
}

export interface AvailabilityResponse {
  resourceAvailabilities: Record<string, ResourceAvailability>;
  mapLinkAvailabilities: Record<string, MapLinkAvailability>;
}

export interface ResourceAvailability {
  resourceId: number;
  availability: number;
  bookingCategoryId: number;
  mapId: number;
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
  availability: Record<string, number>;
}

export interface MonitorResult {
  timestamp: Date;
  parkName: string;
  startDate: string;
  endDate: string;
  availableSites: AvailableSite[];
  newSites: AvailableSite[];
}
