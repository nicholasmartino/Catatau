import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external deps
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

vi.mock("../../src/utils/sleep.js", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/notifications/manager.js", () => ({
  NotificationManager: vi.fn().mockImplementation(() => ({
    notify: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock Playwright entirely
vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue(undefined),
          locator: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            first: vi.fn().mockReturnValue({
              click: vi.fn().mockResolvedValue(undefined),
              isVisible: vi.fn().mockResolvedValue(false),
            }),
          }),
        }),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// Override msUntilNext7am to return 0 (trigger immediately)
vi.mock("../../src/utils/dates.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/utils/dates.js")>(
    "../../src/utils/dates.js",
  );
  return {
    ...actual,
    msUntilNext7am: vi.fn().mockReturnValue(0),
    nowPacific: vi.fn().mockReturnValue(new Date("2026-07-15T07:00:00")),
  };
});

import { runSnatcher } from "../../src/snatcher/snatcher.js";
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

describe("runSnatcher", () => {
  it("finds available sites and notifies", async () => {
    mockedListCampgrounds.mockResolvedValue(resourceLocations as any);
    mockedGetMaps.mockResolvedValue(maps as any);
    mockedSearchAvailability.mockResolvedValue(availableFixture as any);

    await runSnatcher({
      parkName: "golden ears",
      startDate: "2026-07-15",
      endDate: "2026-07-17",
      nights: 2,
      headless: true,
      preWarmMinutes: 0,
    });

    // Should have notified about available sites
    const managerInstance = (NotificationManager as any).mock.results[0].value;
    expect(managerInstance.notify).toHaveBeenCalled();
    const payload = managerInstance.notify.mock.calls[0][0];
    expect(payload.title).toContain("SNATCHER");
    expect(payload.sites.length).toBeGreaterThan(0);
  });

  it("handles no availability gracefully", async () => {
    mockedListCampgrounds.mockResolvedValue(resourceLocations as any);
    mockedGetMaps.mockResolvedValue(maps as any);
    mockedSearchAvailability.mockResolvedValue(noneFixture as any);

    // Should not throw
    await runSnatcher({
      parkName: "golden ears",
      startDate: "2026-07-15",
      endDate: "2026-07-17",
      headless: true,
      preWarmMinutes: 0,
    });

    const managerInstance = (NotificationManager as any).mock.results[0].value;
    expect(managerInstance.notify).not.toHaveBeenCalled();
  });
});
