import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { loadConfig } from "../config/index.js";
import { findCampgrounds, listAllCampgrounds, checkAvailability } from "../availability/checker.js";
import { buildSimpleBookingUrl } from "../booking/url-builder.js";
import { automateBooking } from "../booking/playwright-booker.js";
import { startMonitor } from "../availability/monitor.js";
import { parseDate, formatDate, getMaxBookableDate, getNextReleaseDate } from "../utils/dates.js";
import { logger } from "../utils/logger.js";

const PORT = parseInt(process.env.PORT || "3000");

interface BookingRequest {
  parkName: string;
  startDate: string; // yyyy-MM-dd
  endDate: string;   // yyyy-MM-dd
  partySize?: number;
  equipmentCategoryId?: number;
  subEquipmentCategoryId?: number;
  autoBook?: boolean; // launch Playwright and try to book
  headless?: boolean;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  cors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // GET /api/parks - list all reservable parks
    if (path === "/api/parks" && req.method === "GET") {
      const parks = await listAllCampgrounds();
      json(res, 200, { count: parks.length, parks });
      return;
    }

    // GET /api/parks/search?q=<name> - search parks
    if (path === "/api/parks/search" && req.method === "GET") {
      const query = url.searchParams.get("q");
      if (!query) {
        json(res, 400, { error: "Missing query parameter 'q'" });
        return;
      }
      const parks = await findCampgrounds(query);
      json(res, 200, { count: parks.length, parks });
      return;
    }

    // POST /api/availability - check availability
    if (path === "/api/availability" && req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as BookingRequest;

      if (!body.parkName || !body.startDate || !body.endDate) {
        json(res, 400, { error: "Missing required fields: parkName, startDate, endDate" });
        return;
      }

      const campgrounds = await findCampgrounds(body.parkName);
      if (campgrounds.length === 0) {
        json(res, 404, { error: `No campgrounds found matching "${body.parkName}"` });
        return;
      }

      const results = [];
      for (const cg of campgrounds) {
        const sites = await checkAvailability({
          campground: cg,
          startDate: parseDate(body.startDate),
          endDate: parseDate(body.endDate),
          partySize: body.partySize,
          equipmentCategoryId: body.equipmentCategoryId,
          subEquipmentCategoryId: body.subEquipmentCategoryId,
        });
        results.push({
          campground: cg,
          availableSites: sites.length,
          sites,
        });
      }

      json(res, 200, {
        searchParams: {
          parkName: body.parkName,
          startDate: body.startDate,
          endDate: body.endDate,
          partySize: body.partySize ?? 2,
        },
        results,
      });
      return;
    }

    // POST /api/book - generate booking URL and optionally auto-book
    if (path === "/api/book" && req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as BookingRequest;

      if (!body.parkName || !body.startDate || !body.endDate) {
        json(res, 400, { error: "Missing required fields: parkName, startDate, endDate" });
        return;
      }

      // Find the campground
      const campgrounds = await findCampgrounds(body.parkName);
      if (campgrounds.length === 0) {
        json(res, 404, { error: `No campgrounds found matching "${body.parkName}"` });
        return;
      }

      const campground = campgrounds[0]; // take first match

      // Check availability first
      const sites = await checkAvailability({
        campground,
        startDate: parseDate(body.startDate),
        endDate: parseDate(body.endDate),
        partySize: body.partySize,
        equipmentCategoryId: body.equipmentCategoryId,
        subEquipmentCategoryId: body.subEquipmentCategoryId,
      });

      // Build booking URL
      const bookingUrl = buildSimpleBookingUrl({
        mapId: campground.mapId,
        resourceLocationId: campground.id,
        startDate: body.startDate,
        endDate: body.endDate,
        partySize: body.partySize,
      });

      const result: Record<string, unknown> = {
        campground: campground.name,
        campgroundId: campground.id,
        availableSites: sites.length,
        bookingUrl,
        sites: sites.slice(0, 10), // limit to first 10
      };

      // Optionally launch Playwright to auto-book
      if (body.autoBook) {
        logger.info("Auto-booking requested, launching browser...");
        // Send response first with the URL, then kick off booking
        // (booking is a long process so we respond immediately)
        const bookingPromise = automateBooking({
          bookingUrl,
          headless: body.headless ?? false,
        });

        result.autoBookStarted = true;
        result.message = "Browser launched for auto-booking. Complete payment manually.";

        // Don't await - let it run in background
        bookingPromise.then((r) => {
          logger.info("Auto-booking result: %s", r.message);
        }).catch((e) => {
          logger.error("Auto-booking failed: %s", e);
        });
      }

      json(res, 200, result);
      return;
    }

    // GET /api/booking-url - generate a booking URL with query params
    if (path === "/api/booking-url" && req.method === "GET") {
      const parkName = url.searchParams.get("park");
      const startDate = url.searchParams.get("start");
      const endDate = url.searchParams.get("end");
      const partySize = parseInt(url.searchParams.get("partySize") || "2");

      if (!parkName || !startDate || !endDate) {
        json(res, 400, { error: "Missing required params: park, start, end" });
        return;
      }

      const campgrounds = await findCampgrounds(parkName);
      if (campgrounds.length === 0) {
        json(res, 404, { error: `No campgrounds found matching "${parkName}"` });
        return;
      }

      const cg = campgrounds[0];
      const bookingUrl = buildSimpleBookingUrl({
        mapId: cg.mapId,
        resourceLocationId: cg.id,
        startDate,
        endDate,
        partySize,
      });

      json(res, 200, {
        campground: cg.name,
        bookingUrl,
      });
      return;
    }

    // GET /api/info - system info
    if (path === "/api/info" && req.method === "GET") {
      json(res, 200, {
        maxBookableDate: formatDate(getMaxBookableDate()),
        nextReleaseDate: formatDate(getNextReleaseDate()),
        bookingWindowMonths: 3,
        releaseTime: "7:00 AM Pacific",
      });
      return;
    }

    // GET / - simple landing page
    if (path === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
<!DOCTYPE html>
<html>
<head><title>Camping Reso API</title></head>
<body style="font-family:monospace;max-width:800px;margin:40px auto;padding:0 20px">
<h1>Camping Reso API</h1>
<h2>Endpoints</h2>
<ul>
  <li><b>GET /api/parks</b> - List all reservable BC Parks campgrounds</li>
  <li><b>GET /api/parks/search?q=name</b> - Search parks by name</li>
  <li><b>POST /api/availability</b> - Check campsite availability</li>
  <li><b>POST /api/book</b> - Generate booking URL & optionally auto-book</li>
  <li><b>GET /api/booking-url?park=&start=&end=&partySize=</b> - Quick booking URL</li>
  <li><b>GET /api/info</b> - Booking window info</li>
</ul>
<h2>Example: Check Availability</h2>
<pre>
curl -X POST http://localhost:${PORT}/api/availability \\
  -H "Content-Type: application/json" \\
  -d '{
    "parkName": "golden ears",
    "startDate": "2026-07-15",
    "endDate": "2026-07-17",
    "partySize": 4
  }'
</pre>
<h2>Example: Book</h2>
<pre>
curl -X POST http://localhost:${PORT}/api/book \\
  -H "Content-Type: application/json" \\
  -d '{
    "parkName": "golden ears",
    "startDate": "2026-07-15",
    "endDate": "2026-07-17",
    "partySize": 4,
    "autoBook": true
  }'
</pre>
</body>
</html>
      `);
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    logger.error({ error }, "Request handler error");
    json(res, 500, { error: String(error) });
  }
}

export function startServer(port?: number): ReturnType<typeof createServer> {
  const p = port ?? PORT;
  const server = createServer(handleRequest);
  server.listen(p, () => {
    logger.info(`Camping Reso API server running on http://localhost:${p}`);
    console.log(`\nCamping Reso API: http://localhost:${p}`);
    console.log(`API docs: http://localhost:${p}/`);
  });
  return server;
}

// Allow running directly
if (process.argv[1]?.endsWith("api.ts") || process.argv[1]?.endsWith("api.js")) {
  startServer();
}
