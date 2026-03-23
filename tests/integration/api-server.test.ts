import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "http";

// Mock the API endpoints
vi.mock("../../src/api/endpoints.js", () => ({
  listCampgrounds: vi.fn(),
  getMaps: vi.fn(),
  searchAvailability: vi.fn(),
  listEquipment: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => ({
  loadConfig: vi.fn(() => ({
    defaultPartySize: 2,
    defaultEquipmentCategoryId: -32768,
    requestDelayMs: 0,
    sessionCacheTtlMinutes: 30,
    monitorIntervalSeconds: 300,
    bookingHeadless: false,
    bcparksBaseUrl: "https://camping.bcparks.ca",
  })),
}));

// Mock session to avoid Playwright launch
vi.mock("../../src/api/session.js", () => ({
  getSession: vi.fn().mockResolvedValue({
    cookies: "test=cookie",
    userAgent: "Test/1.0",
  }),
  refreshSession: vi.fn().mockResolvedValue({
    cookies: "test=cookie",
    userAgent: "Test/1.0",
  }),
}));

// Mock playwright booker
vi.mock("../../src/booking/playwright-booker.js", () => ({
  automateBooking: vi.fn().mockResolvedValue({
    success: true,
    message: "Mocked booking",
    step: "test",
  }),
}));

import { startServer } from "../../src/server/api.js";
import { listCampgrounds, getMaps, searchAvailability } from "../../src/api/endpoints.js";

import resourceLocations from "../fixtures/resource-locations.json";
import maps from "../fixtures/maps.json";
import availableFixture from "../fixtures/availability-available.json";

const mockedListCampgrounds = vi.mocked(listCampgrounds);
const mockedGetMaps = vi.mocked(getMaps);
const mockedSearchAvailability = vi.mocked(searchAvailability);

let server: ReturnType<typeof createServer>;
let port: number;

beforeAll(async () => {
  // Use a random high port to avoid conflicts
  port = 40000 + Math.floor(Math.random() * 10000);
  server = startServer(port);
  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 500));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
});

function apiUrl(path: string): string {
  return `http://localhost:${port}${path}`;
}

describe("API Server", () => {
  describe("GET /", () => {
    it("returns HTML landing page", async () => {
      const res = await fetch(apiUrl("/"));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Camping Reso API");
      expect(text).toContain("/api/parks");
    });
  });

  describe("GET /api/info", () => {
    it("returns booking window info", async () => {
      const res = await fetch(apiUrl("/api/info"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("maxBookableDate");
      expect(data).toHaveProperty("nextReleaseDate");
      expect(data.bookingWindowMonths).toBe(3);
      expect(data.releaseTime).toBe("7:00 AM Pacific");
    });
  });

  describe("GET /api/parks", () => {
    it("returns all parks", async () => {
      mockedListCampgrounds.mockResolvedValue(resourceLocations as any);

      const res = await fetch(apiUrl("/api/parks"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBe(3); // excludes non-reservable Joffre Lakes
      expect(data.parks.length).toBe(3);
    });
  });

  describe("GET /api/parks/search", () => {
    it("searches parks by name", async () => {
      mockedListCampgrounds.mockResolvedValue(resourceLocations as any);

      const res = await fetch(apiUrl("/api/parks/search?q=golden"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBe(1);
      expect(data.parks[0].name).toBe("Golden Ears Provincial Park");
    });

    it("returns 400 when query missing", async () => {
      const res = await fetch(apiUrl("/api/parks/search"));
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/availability", () => {
    it("checks availability for a park", async () => {
      mockedListCampgrounds.mockResolvedValue(resourceLocations as any);
      mockedGetMaps.mockResolvedValue(maps as any);
      mockedSearchAvailability.mockResolvedValue(availableFixture as any);

      const res = await fetch(apiUrl("/api/availability"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parkName: "golden ears",
          startDate: "2026-07-15",
          endDate: "2026-07-17",
          partySize: 4,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results).toHaveLength(1);
      expect(data.results[0].campground.name).toBe("Golden Ears Provincial Park");
      expect(data.results[0].availableSites).toBeGreaterThan(0);
    });

    it("returns 400 for missing fields", async () => {
      const res = await fetch(apiUrl("/api/availability"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parkName: "golden ears" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown park", async () => {
      mockedListCampgrounds.mockResolvedValue(resourceLocations as any);

      const res = await fetch(apiUrl("/api/availability"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parkName: "nonexistent",
          startDate: "2026-07-15",
          endDate: "2026-07-17",
        }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/book", () => {
    it("returns booking URL and availability", async () => {
      mockedListCampgrounds.mockResolvedValue(resourceLocations as any);
      mockedGetMaps.mockResolvedValue(maps as any);
      mockedSearchAvailability.mockResolvedValue(availableFixture as any);

      const res = await fetch(apiUrl("/api/book"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parkName: "golden ears",
          startDate: "2026-07-15",
          endDate: "2026-07-17",
          partySize: 2,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.campground).toBe("Golden Ears Provincial Park");
      expect(data.bookingUrl).toContain("camping.bcparks.ca");
      expect(data.bookingUrl).toContain("create-booking");
      expect(data.availableSites).toBeGreaterThan(0);
    });

    it("returns 400 for missing fields", async () => {
      const res = await fetch(apiUrl("/api/book"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/booking-url", () => {
    it("generates booking URL from query params", async () => {
      mockedListCampgrounds.mockResolvedValue(resourceLocations as any);

      const res = await fetch(
        apiUrl("/api/booking-url?park=golden+ears&start=2026-07-15&end=2026-07-17&partySize=4"),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.campground).toBe("Golden Ears Provincial Park");
      expect(data.bookingUrl).toContain("partySize=4");
    });

    it("returns 400 for missing params", async () => {
      const res = await fetch(apiUrl("/api/booking-url?park=test"));
      expect(res.status).toBe(400);
    });
  });

  describe("404 handling", () => {
    it("returns 404 for unknown routes", async () => {
      const res = await fetch(apiUrl("/api/unknown"));
      expect(res.status).toBe(404);
    });
  });

  describe("CORS", () => {
    it("handles OPTIONS preflight", async () => {
      const res = await fetch(apiUrl("/api/parks"), { method: "OPTIONS" });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });
  });
});
