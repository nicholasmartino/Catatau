import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../../src/api/endpoints.js", () => ({
  listCampgrounds: vi.fn(),
  getMaps: vi.fn(),
  searchAvailability: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => ({
  loadConfig: vi.fn(() => ({
    defaultPartySize: 2,
    defaultEquipmentCategoryId: -32768,
    requestDelayMs: 0,
    sessionCacheTtlMinutes: 30,
    monitorIntervalSeconds: 1,
    morningPreCheckSeconds: 0,
  })),
}));

// Mock sleep to not actually wait
vi.mock("../../src/utils/sleep.js", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// Mock notifications
vi.mock("../../src/notifications/manager.js", () => ({
  NotificationManager: vi.fn().mockImplementation(() => ({
    notify: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { startMonitor } from "../../src/availability/monitor.js";
import { listCampgrounds, getMaps, searchAvailability } from "../../src/api/endpoints.js";
import { NotificationManager } from "../../src/notifications/manager.js";

import resourceLocations from "../fixtures/resource-locations.json";
import maps from "../fixtures/maps.json";
import availableFixture from "../fixtures/availability-available.json";
import noneFixture from "../fixtures/availability-none.json";

const mockedListCampgrounds = vi.mocked(listCampgrounds);
const mockedGetMaps = vi.mocked(getMaps);
const mockedSearchAvailability = vi.mocked(searchAvailability);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startMonitor", () => {
  it("runs specified number of checks and stops", async () => {
    mockedListCampgrounds.mockResolvedValue(resourceLocations as any);
    mockedGetMaps.mockResolvedValue(maps as any);
    mockedSearchAvailability.mockResolvedValue(noneFixture as any);

    await startMonitor({
      parkName: "golden ears",
      startDate: new Date("2026-07-15"),
      endDate: new Date("2026-07-17"),
      maxChecks: 3,
      intervalSeconds: 0,
    });

    // getMaps called once per check = 3 times
    expect(mockedGetMaps).toHaveBeenCalledTimes(3);
  });

  it("sends notification when new sites appear", async () => {
    mockedListCampgrounds.mockResolvedValue(resourceLocations as any);
    mockedGetMaps.mockResolvedValue(maps as any);

    // First check: nothing. Second check: sites appear.
    mockedSearchAvailability
      .mockResolvedValueOnce(noneFixture as any)
      .mockResolvedValueOnce(availableFixture as any);

    await startMonitor({
      parkName: "golden ears",
      startDate: new Date("2026-07-15"),
      endDate: new Date("2026-07-17"),
      maxChecks: 2,
      intervalSeconds: 0,
    });

    // NotificationManager.notify should have been called for new sites
    const managerInstance = (NotificationManager as any).mock.results[0].value;
    expect(managerInstance.notify).toHaveBeenCalledTimes(1);

    const notifyPayload = managerInstance.notify.mock.calls[0][0];
    expect(notifyPayload.title).toContain("sites available");
    expect(notifyPayload.sites.length).toBeGreaterThan(0);
  });

  it("does not re-notify for already seen sites", async () => {
    mockedListCampgrounds.mockResolvedValue(resourceLocations as any);
    mockedGetMaps.mockResolvedValue(maps as any);

    // Both checks return same available sites
    mockedSearchAvailability.mockResolvedValue(availableFixture as any);

    await startMonitor({
      parkName: "golden ears",
      startDate: new Date("2026-07-15"),
      endDate: new Date("2026-07-17"),
      maxChecks: 3,
      intervalSeconds: 0,
    });

    const managerInstance = (NotificationManager as any).mock.results[0].value;
    // Should only notify on first check (new sites), not subsequent (same sites)
    expect(managerInstance.notify).toHaveBeenCalledTimes(1);
  });

  it("returns early if park not found", async () => {
    mockedListCampgrounds.mockResolvedValue(resourceLocations as any);

    await startMonitor({
      parkName: "nonexistent park",
      startDate: new Date("2026-07-15"),
      endDate: new Date("2026-07-17"),
      maxChecks: 5,
    });

    // Should not have called getMaps at all
    expect(mockedGetMaps).not.toHaveBeenCalled();
  });
});
