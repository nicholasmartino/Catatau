export interface LocalizedValue {
  cultureName: string;
  shortName: string;
  fullName: string;
}

export interface ResourceLocation {
  resourceLocationId: number;
  rootMapId: number;
  localizedValues: LocalizedValue[];
  resourceCategoryIds: number[];
}

export interface CampgroundMap {
  mapId: number;
  localizedValues: Array<{ cultureName: string; title: string }>;
  mapLinks: MapLink[];
}

export interface MapLink {
  resourceLocationId: number;
  transactionLocationId: number;
  childMapId?: number;
  localizations: Array<{ cultureName: string; title: string }>;
}

export interface Campground {
  id: number;
  name: string;
  mapId: number;
  regionId: number;
  resourceCategoryIds: number[];
  hasAlerts: boolean;
}
