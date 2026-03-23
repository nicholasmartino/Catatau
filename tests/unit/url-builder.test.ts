import { describe, it, expect } from "vitest";
import {
  buildBookingUrl,
  buildSimpleBookingUrl,
} from "../../src/booking/url-builder.js";

describe("url-builder", () => {
  describe("buildBookingUrl", () => {
    it("generates correct URL with all parameters", () => {
      const url = buildBookingUrl({
        mapId: 1001,
        resourceLocationId: 100,
        startDate: new Date(2026, 6, 15),
        endDate: new Date(2026, 6, 17),
        partySize: 4,
        equipmentCategoryId: -32768,
      });

      const parsed = new URL(url);
      expect(parsed.origin).toBe("https://camping.bcparks.ca");
      expect(parsed.pathname).toBe("/create-booking/results");
      expect(parsed.searchParams.get("mapId")).toBe("1001");
      expect(parsed.searchParams.get("resourceLocationId")).toBe("100");
      expect(parsed.searchParams.get("bookingCategoryId")).toBe("0");
      expect(parsed.searchParams.get("startDate")).toBe("2026-07-15");
      expect(parsed.searchParams.get("endDate")).toBe("2026-07-17");
      expect(parsed.searchParams.get("isReserving")).toBe("true");
      expect(parsed.searchParams.get("equipmentId")).toBe("-32768");
      expect(parsed.searchParams.get("partySize")).toBe("4");
    });

    it("includes subEquipmentId when provided", () => {
      const url = buildBookingUrl({
        mapId: 1001,
        resourceLocationId: 100,
        startDate: new Date(2026, 6, 15),
        endDate: new Date(2026, 6, 17),
        partySize: 2,
        equipmentCategoryId: -32768,
        subEquipmentCategoryId: 10,
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get("subEquipmentId")).toBe("10");
    });

    it("omits subEquipmentId when not provided", () => {
      const url = buildBookingUrl({
        mapId: 1001,
        resourceLocationId: 100,
        startDate: new Date(2026, 6, 15),
        endDate: new Date(2026, 6, 17),
        partySize: 2,
        equipmentCategoryId: -32768,
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.has("subEquipmentId")).toBe(false);
    });
  });

  describe("buildSimpleBookingUrl", () => {
    it("generates URL with string dates", () => {
      const url = buildSimpleBookingUrl({
        mapId: 2001,
        resourceLocationId: 200,
        startDate: "2026-08-01",
        endDate: "2026-08-03",
        partySize: 6,
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get("mapId")).toBe("2001");
      expect(parsed.searchParams.get("startDate")).toBe("2026-08-01");
      expect(parsed.searchParams.get("endDate")).toBe("2026-08-03");
      expect(parsed.searchParams.get("partySize")).toBe("6");
      expect(parsed.searchParams.get("equipmentId")).toBe("-32768");
    });

    it("defaults party size to 2", () => {
      const url = buildSimpleBookingUrl({
        mapId: 2001,
        resourceLocationId: 200,
        startDate: "2026-08-01",
        endDate: "2026-08-03",
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get("partySize")).toBe("2");
    });
  });
});
