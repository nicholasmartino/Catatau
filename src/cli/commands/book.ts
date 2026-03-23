import { Command } from "commander";
import { automateBooking } from "../../booking/playwright-booker.js";
import { buildSimpleBookingUrl } from "../../booking/url-builder.js";
import { printHeader, printSuccess, printError } from "../formatters.js";

export const bookCommand = new Command("book")
  .description("Open browser and attempt automated booking")
  .option("--url <bookingUrl>", "Direct booking URL")
  .option("--map-id <id>", "Map ID (if not using --url)")
  .option("--location-id <id>", "Resource Location ID (if not using --url)")
  .option("--start <date>", "Start date YYYY-MM-DD (if not using --url)")
  .option("--end <date>", "End date YYYY-MM-DD (if not using --url)")
  .option("--party-size <n>", "Party size", "2")
  .option("--headless", "Run in headless mode (no visible browser)")
  .action(async (options) => {
    let bookingUrl = options.url;

    if (!bookingUrl) {
      if (
        !options.mapId ||
        !options.locationId ||
        !options.start ||
        !options.end
      ) {
        console.error(
          "Error: Either --url or all of --map-id, --location-id, --start, --end are required",
        );
        process.exit(1);
      }

      bookingUrl = buildSimpleBookingUrl({
        mapId: parseInt(options.mapId),
        resourceLocationId: parseInt(options.locationId),
        startDate: options.start,
        endDate: options.end,
        partySize: parseInt(options.partySize),
      });
    }

    printHeader("Automated Booking");
    console.log(`URL: ${bookingUrl}\n`);

    const result = await automateBooking({
      bookingUrl,
      headless: !!options.headless,
    });

    if (result.success) {
      printSuccess(result.message);
    } else {
      printError(result.message);
    }
  });
