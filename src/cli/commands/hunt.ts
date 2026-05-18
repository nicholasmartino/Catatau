import { Command } from "commander";
import { startMonitor } from "../../availability/monitor.js";
import { parseDate } from "../../utils/dates.js";
import { printHeader } from "../formatters.js";

export const huntCommand = new Command("hunt")
  .description("Monitor availability and auto-add to cart when a spot opens")
  .requiredOption("--park <name>", "Park/campground name to search")
  .requiredOption("--start <date>", "Start date (YYYY-MM-DD)")
  .requiredOption("--end <date>", "End date (YYYY-MM-DD)")
  .option("--party-size <n>", "Party size", "2")
  .option("--interval <seconds>", "Check interval in seconds", "30")
  .option("--no-auto-cart", "Disable auto-add to cart (notify only)")
  .option("--headless", "Run Playwright browser in headless mode")
  .action(async (options) => {
    printHeader(
      `Hunt: "${options.park}" (${options.start} → ${options.end})`,
    );
    console.log(`Monitor interval: ${options.interval}s`);
    console.log(`Auto-cart: ${options.autoCart ? "enabled" : "disabled"}`);

    await startMonitor({
      parkName: options.park,
      startDate: parseDate(options.start),
      endDate: parseDate(options.end),
      partySize: parseInt(options.partySize),
      intervalSeconds: parseInt(options.interval),
      autoCart: options.autoCart,
    });
  });
