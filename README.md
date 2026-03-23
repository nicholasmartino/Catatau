# Camping Reso

BC Parks camping reservation automation tool — front-run the competition.

A CLI tool and REST API server for checking BC Parks campsite availability, monitoring for openings, and automating bookings via Playwright.

## Setup

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
npm install
npx playwright install chromium
```

### Configuration

Copy the example env file and fill in your details:

```bash
cp .env.example .env
```

Available environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `BCPARKS_BASE_URL` | `https://camping.bcparks.ca` | BC Parks API base URL |
| `REQUEST_DELAY_MS` | `500` | Rate limiting delay between requests (ms) |
| `SESSION_CACHE_TTL_MINUTES` | `30` | Browser session cache lifetime |
| `MONITOR_INTERVAL_SECONDS` | `300` | How often the monitor checks availability |
| `MORNING_CHECK_ENABLED` | `true` | Enable 7 AM release monitoring |
| `MORNING_PRE_CHECK_SECONDS` | `5` | Seconds before 7 AM to start checking |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server for email notifications |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password / app password |
| `NOTIFY_EMAIL_TO` | — | Email address for notifications |
| `DISCORD_WEBHOOK_URL` | — | Discord webhook for notifications |
| `SLACK_WEBHOOK_URL` | — | Slack webhook for notifications |
| `BOOKING_HEADLESS` | `false` | Run Playwright in headless mode |
| `DEFAULT_PARTY_SIZE` | `2` | Default party size for searches |
| `DEFAULT_EQUIPMENT_CATEGORY_ID` | `-32768` | Default equipment category |

## CLI Commands

Run commands with `npx tsx src/index.ts` (dev) or `npx camping-reso` (after build).

### List all parks

```bash
npx camping-reso list-parks
npx camping-reso list-parks --json
```

### Search parks by name

```bash
npx camping-reso search "manning"
npx camping-reso search "golden ears" --json
```

### List equipment categories

```bash
npx camping-reso list-equipment
npx camping-reso list-equipment --json
```

### Check availability

```bash
npx camping-reso check \
  --park "manning" \
  --start 2026-07-15 \
  --end 2026-07-17 \
  --party-size 4
```

Add `--json` for JSON output.

### Book a campsite

Using a direct booking URL:

```bash
npx camping-reso book --url "https://camping.bcparks.ca/create-booking/results?..."
```

Using park details:

```bash
npx camping-reso book \
  --map-id 1001 \
  --location-id 100 \
  --start 2026-07-15 \
  --end 2026-07-17 \
  --party-size 4
```

Add `--headless` to run the browser without a visible window.

### Monitor availability

Continuously check for openings:

```bash
npx camping-reso monitor \
  --park "manning" \
  --start 2026-07-15 \
  --end 2026-07-17 \
  --interval 60 \
  --party-size 4
```

Schedule for the 7 AM daily release:

```bash
npx camping-reso monitor --park "manning" --morning --nights 2
```

Run a morning blitz immediately (for testing):

```bash
npx camping-reso monitor --park "manning" --blitz --nights 2
```

### Snatch (auto-book on release)

Waits for the 7 AM booking window to open, then auto-books:

```bash
npx camping-reso snatch \
  --park "manning" \
  --nights 2 \
  --party-size 4 \
  --pre-warm 5
```

Options:

| Flag | Default | Description |
|------|---------|-------------|
| `--park <name>` | *required* | Park name to target |
| `--start <date>` | next release date | Start date (YYYY-MM-DD) |
| `--end <date>` | start + nights | End date (YYYY-MM-DD) |
| `--nights <n>` | `2` | Number of nights |
| `--party-size <n>` | `2` | Party size |
| `--pre-warm <min>` | `5` | Minutes before 7 AM to start warming up |
| `--headless` | off | Run browser in headless mode |

### Start the API server

```bash
npx camping-reso serve
npx camping-reso serve --port 8080
```

## REST API

Start the server with `npx camping-reso serve` (default port `3000`).

No authentication is required. CORS is enabled for all origins.

### GET /api/parks

List all reservable BC Parks campgrounds.

```bash
curl http://localhost:3000/api/parks
```

### GET /api/parks/search?q=\<name\>

Search parks by name.

```bash
curl "http://localhost:3000/api/parks/search?q=manning"
```

### GET /api/info

Get booking window info (max bookable date, next release date).

```bash
curl http://localhost:3000/api/info
```

### GET /api/booking-url

Generate a booking URL from query params.

```bash
curl "http://localhost:3000/api/booking-url?park=manning&start=2026-07-15&end=2026-07-17&partySize=4"
```

### POST /api/availability

Check campsite availability.

```bash
curl -X POST http://localhost:3000/api/availability \
  -H "Content-Type: application/json" \
  -d '{
    "parkName": "manning",
    "startDate": "2026-07-15",
    "endDate": "2026-07-17",
    "partySize": 4
  }'
```

Optional fields: `equipmentCategoryId`, `subEquipmentCategoryId`.

### POST /api/book

Generate a booking URL and optionally launch Playwright to auto-book.

```bash
curl -X POST http://localhost:3000/api/book \
  -H "Content-Type: application/json" \
  -d '{
    "parkName": "manning",
    "startDate": "2026-07-15",
    "endDate": "2026-07-17",
    "partySize": 4,
    "autoBook": true,
    "headless": false
  }'
```

Set `autoBook: false` (or omit it) to only get the booking URL without launching a browser.

### Error responses

```bash
# Missing required fields
curl -X POST http://localhost:3000/api/availability \
  -H "Content-Type: application/json" \
  -d '{}'
# → 400 { "error": "Missing required fields: parkName, startDate, endDate" }

# Unknown park
curl -X POST http://localhost:3000/api/availability \
  -H "Content-Type: application/json" \
  -d '{ "parkName": "nonexistent", "startDate": "2026-07-15", "endDate": "2026-07-17" }'
# → 404 { "error": "No campgrounds found matching \"nonexistent\"" }
```

## Testing

```bash
npm test            # run all tests once
npm run test:watch  # watch mode
```

Tests are in `tests/` and use Vitest. Integration tests mock the BC Parks API and Playwright.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Run CLI in dev mode (via tsx) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled CLI from `dist/` |
| `npm run serve` | Start the API server in dev mode |
| `npm run snatch` | Run the snatcher in dev mode |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
