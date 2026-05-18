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
  mapName: string;
  resourceLocationId: number;
  localizedValues: {
    en: string;
    fr?: string;
  };
  mapLinks: MapLink[];
}

export interface MapLink {
  mapLinkId: number;
  parentMapId: number;
  childMapId: number;
  title: string;
  localizedValues: {
    en: string;
    fr?: string;
  };
}

export interface Campground {
  id: number;
  name: string;
  mapId: number;
  regionId: number;
  resourceCategoryIds: number[];
  hasAlerts: boolean;
}
