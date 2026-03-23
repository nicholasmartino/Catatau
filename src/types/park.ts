export interface ResourceLocation {
  resourceLocationId: number;
  resourceLocationLocalizedValues: LocalizedValues;
  mapId: number;
  regionId: number;
  description: string;
  hasAlerts: boolean;
  resourceCategoryIds: number[];
  parkAlerts: ParkAlert[];
}

export interface LocalizedValues {
  en: string;
  fr?: string;
}

export interface ParkAlert {
  alertId: number;
  alertTitle: string;
  alertDescription: string;
}

export interface CampgroundMap {
  mapId: number;
  mapName: string;
  resourceLocationId: number;
  localizedValues: LocalizedValues;
  mapLinks: MapLink[];
}

export interface MapLink {
  mapLinkId: number;
  parentMapId: number;
  childMapId: number;
  title: string;
  localizedValues: LocalizedValues;
}

export interface Campground {
  id: number;
  name: string;
  mapId: number;
  regionId: number;
  resourceCategoryIds: number[];
  hasAlerts: boolean;
}
