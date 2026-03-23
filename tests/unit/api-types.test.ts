import { describe, it, expect } from "vitest";
import {
  resourceLocationSchema,
  campgroundMapSchema,
  availabilityResponseSchema,
  equipmentCategorySchema,
} from "../../src/api/types.js";
import { z } from "zod";

import resourceLocationsFixture from "../fixtures/resource-locations.json";
import mapsFixture from "../fixtures/maps.json";
import availableFixture from "../fixtures/availability-available.json";
import noneFixture from "../fixtures/availability-none.json";
import equipmentFixture from "../fixtures/equipment.json";

describe("API response schema validation", () => {
  describe("resourceLocationSchema", () => {
    it("parses valid resource locations", () => {
      const result = z.array(resourceLocationSchema).parse(resourceLocationsFixture);
      expect(result).toHaveLength(4);
      expect(result[0].resourceLocationId).toBe(100);
      expect(result[0].resourceLocationLocalizedValues.en).toBe(
        "Golden Ears Provincial Park",
      );
    });

    it("applies defaults for missing optional fields", () => {
      const minimal = {
        resourceLocationId: 999,
        resourceLocationLocalizedValues: { en: "Test Park" },
        mapId: 9999,
        regionId: 1,
      };
      const result = resourceLocationSchema.parse(minimal);
      expect(result.description).toBe("");
      expect(result.hasAlerts).toBe(false);
      expect(result.resourceCategoryIds).toEqual([]);
      expect(result.parkAlerts).toEqual([]);
    });

    it("rejects invalid data", () => {
      expect(() =>
        resourceLocationSchema.parse({ resourceLocationId: "not-a-number" }),
      ).toThrow();
    });
  });

  describe("campgroundMapSchema", () => {
    it("parses valid maps with links", () => {
      const result = z.array(campgroundMapSchema).parse(mapsFixture);
      expect(result).toHaveLength(1);
      expect(result[0].mapId).toBe(1001);
      expect(result[0].mapLinks).toHaveLength(2);
      expect(result[0].mapLinks[0].childMapId).toBe(1002);
    });

    it("defaults mapLinks to empty array", () => {
      const minimal = { mapId: 5000 };
      const result = campgroundMapSchema.parse(minimal);
      expect(result.mapLinks).toEqual([]);
    });
  });

  describe("availabilityResponseSchema", () => {
    it("parses response with available sites", () => {
      const result = availabilityResponseSchema.parse(availableFixture);
      const resources = Object.values(result.resourceAvailabilities);
      const available = resources.filter((r) => r.availability === 0);
      expect(available).toHaveLength(2);
    });

    it("parses response with no available sites", () => {
      const result = availabilityResponseSchema.parse(noneFixture);
      const resources = Object.values(result.resourceAvailabilities);
      const available = resources.filter((r) => r.availability === 0);
      expect(available).toHaveLength(0);
    });

    it("parses map link availabilities", () => {
      const result = availabilityResponseSchema.parse(availableFixture);
      const links = Object.values(result.mapLinkAvailabilities);
      expect(links).toHaveLength(1);
      expect(links[0].childMapId).toBe(1002);
    });

    it("defaults to empty objects", () => {
      const result = availabilityResponseSchema.parse({});
      expect(result.resourceAvailabilities).toEqual({});
      expect(result.mapLinkAvailabilities).toEqual({});
    });
  });

  describe("equipmentCategorySchema", () => {
    it("parses equipment categories with sub-categories", () => {
      const result = z.array(equipmentCategorySchema).parse(equipmentFixture);
      expect(result).toHaveLength(2);
      expect(result[0].localizedValues.en).toBe("Tent/Vehicle");
      expect(result[0].subEquipmentCategories).toHaveLength(3);
    });
  });
});
