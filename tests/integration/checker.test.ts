import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Campground } from "../../src/types/park.js";

// Mock the API endpoints module
vi.mock("../../src/api/endpoints.js", () => ({
  listCampgrounds: vi.fn(),
  getMaps: vi.fn(),
  searchAvailability: vi.fn(),
}));

// Mock the config module
vi.mock("../../src/config/index.js", () => ({
  loadConfig: vi.fn(() => ({
    defaultPartySize: 2,
    defaultEquipmentCategoryId: -32768,
    requestDelayMs: 0,
    sessionCacheTtlMinutes: 30,
  })),
}));

import {
  findCampgrounds,
  listAllCampgrounds,
  checkAvailability,
  quickCheck,
} from "../../src/availability/checker.js";
import { listCampgrounds, getMaps, searchAvailability } from "../../src/api/endpoints.js";

import resourceLocations from "../fixtures/resource-locations.json";
import maps from "../fixtures/maps.json";
import availableFixture from "../fixtures/availability-available.json";
import noneFixture from "../fixtures/availability-none.json";
import childMapFixture from "../fixtures/availability-child-map.json";

const mockedListCampgrounds = vi.mocked(listCampgrounds);
const mockedGetMaps = vi.mocked(getMaps);
const mockedSearchAvailability = vi.mocked(searchAvailability);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findCampgrounds", () => {
  it("filters by name (case-insensitive)", async () => {
    mockedListCampgrounds.mockResolvedValue(resourceLocations as any);

    const results = await findCampgrounds("golden ears");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Golden Ears Provincial Park");
    expect(results[0].id).toBe(100);
  });

  it("excludes non-reservable locations (e.g. day use)", async () => {
    mockedListCampgrounds.mockResolvedValue(resourceLocations as any);

    const results = await findCampgrounds("joffre");
    expect(results).toHaveLength(0); // Joffre Lakes has category 99, not reservable
  });

  it("returns multiple matches", async () => {
    mockedListCampgrounds.mockResolvedValue(resourceLocations as any);

    const results = await findCampgrounds("provincial park");
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty for no matches", async () => {
    mockedListCampgrounds.mockResolvedValue(resourceLocations as any);

    const results = await findCampgrounds("nonexistent park");
    expect(results).toHaveLength(0);
  });
});

describe("listAllCampgrounds", () => {
  it("returns all reservable campgrounds sorted by name", async () => {
    mockedListCampgrounds.mockResolvedValue(resourceLocations as any);

    const results = await listAllCampgrounds();
    // Should exclude Joffre Lakes (non-reservable)
    expect(results).toHaveLength(3);
    // Should be sorted alphabetically
    expect(results[0].name).toBe("Golden Ears Provincial Park");
    expect(results[1].name).toBe("Manning Provincial Park");
    expect(results[2].name).toBe("Rathtrevor Beach Provincial Park");
  });
});

describe("checkAvailability", () => {
  const campground: Campground = {
    id: 100,
    name: "Golden Ears Provincial Park",
    mapId: 1001,
    regionId: 1,
    resourceCategoryIds: [-2147483648],
    hasAlerts: false,
  };

  it("finds available sites from root map", async () => {
    mockedGetMaps.mockResolvedValue(maps as any);
    mockedSearchAvailability.mockResolvedValue(availableFixture as any);

    const sites = await checkAvailability({
      campground,
      startDate: new Date("2026-07-15"),
      endDate: new Date("2026-07-17"),
    });

    // 2 available from root (10001, 10002) + 1 from child map (20001) following the link
    // Root has 2 available resources + 1 mapLink that triggers child search
    expect(sites.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty when no sites available", async () => {
    mockedGetMaps.mockResolvedValue(maps as any);
    mockedSearchAvailability.mockResolvedValue(noneFixture as any);

    const sites = await checkAvailability({
      campground,
      startDate: new Date("2026-07-15"),
      endDate: new Date("2026-07-17"),
    });

    expect(sites).toHaveLength(0);
  });

  it("returns empty when no maps found", async () => {
    mockedGetMaps.mockResolvedValue([]);

    const sites = await checkAvailability({
      campground,
      startDate: new Date("2026-07-15"),
      endDate: new Date("2026-07-17"),
    });

    expect(sites).toHaveLength(0);
  });

  it("follows map links recursively", async () => {
    mockedGetMaps.mockResolvedValue(maps as any);

    // First call: root map has available sites + map link
    // Second call: child map has one more available site
    mockedSearchAvailability
      .mockResolvedValueOnce(availableFixture as any)
      .mockResolvedValueOnce(childMapFixture as any);

    const sites = await checkAvailability({
      campground,
      startDate: new Date("2026-07-15"),
      endDate: new Date("2026-07-17"),
    });

    // 2 from root + 1 from child = 3
    expect(sites).toHaveLength(3);
    expect(mockedSearchAvailability).toHaveBeenCalledTimes(2);
  });

  it("includes booking URL for each site", async () => {
    mockedGetMaps.mockResolvedValue(maps as any);
    mockedSearchAvailability.mockResolvedValue(availableFixture as any);

    const sites = await checkAvailability({
      campground,
      startDate: new Date("2026-07-15"),
      endDate: new Date("2026-07-17"),
    });

    for (const site of sites) {
      expect(site.bookingUrl).toContain("camping.bcparks.ca");
      expect(site.bookingUrl).toContain("create-booking");
      expect(site.bookingUrl).toContain("mapId=");
    }
  });
});

describe("quickCheck", () => {
  it("searches by park name and returns results", async () => {
    mockedListCampgrounds.mockResolvedValue(resourceLocations as any);
    mockedGetMaps.mockResolvedValue(maps as any);
    mockedSearchAvailability.mockResolvedValue(availableFixture as any);

    const results = await quickCheck({
      parkName: "golden ears",
      startDate: new Date("2026-07-15"),
      endDate: new Date("2026-07-17"),
    });

    expect(results).toHaveLength(1);
    expect(results[0].campground.name).toBe("Golden Ears Provincial Park");
    expect(results[0].sites.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty when park not found", async () => {
    mockedListCampgrounds.mockResolvedValue(resourceLocations as any);

    const results = await quickCheck({
      parkName: "nonexistent",
      startDate: new Date("2026-07-15"),
      endDate: new Date("2026-07-17"),
    });

    expect(results).toHaveLength(0);
  });
});
