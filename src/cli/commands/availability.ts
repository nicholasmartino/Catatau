import { Command } from "commander";
import { quickCheck } from "../../availability/checker.js";
import { parseDate } from "../../utils/dates.js";
import {
  formatAvailabilityTable,
  printHeader,
  printWarning,
} from "../formatters.js";

export const availabilityCommand = new Command("check")
  .description("Check campsite availability for a date range")
  .requiredOption("--park <name>", "Park/campground name to search")
  .requiredOption("--start <date>", "Start date (YYYY-MM-DD)")
  .requiredOption("--end <date>", "End date (YYYY-MM-DD)")
  .option("--party-size <n>", "Party size", "2")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const startDate = parseDate(options.start);
    const endDate = parseDate(options.end);

    printHeader(
      `Availability: "${options.park}" (${options.start} → ${options.end})`,
    );

    const results = await quickCheck({
      parkName: options.park,
      startDate,
      endDate,
      partySize: parseInt(options.partySize),
    });

    if (results.length === 0) {
      printWarning(`No campgrounds found matching "${options.park}"`);
      return;
    }

    for (const { campground, sites } of results) {
      console.log(`\n📍 ${campground.name} (ID: ${campground.id})`);

      if (options.json) {
        console.log(JSON.stringify(sites, null, 2));
      } else {
        console.log(formatAvailabilityTable(sites));
      }
    }
  });
