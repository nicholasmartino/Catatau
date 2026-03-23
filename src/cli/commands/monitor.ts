import { Command } from "commander";
import { startMonitor } from "../../availability/monitor.js";
import { scheduleMorningCheck, runImmediateBlitz } from "../../availability/scheduler.js";
import { parseDate } from "../../utils/dates.js";
import { printHeader } from "../formatters.js";

export const monitorCommand = new Command("monitor")
  .description("Continuously monitor campsite availability")
  .requiredOption("--park <name>", "Park/campground name to search")
  .option("--start <date>", "Start date (YYYY-MM-DD)")
  .option("--end <date>", "End date (YYYY-MM-DD)")
  .option("--party-size <n>", "Party size", "2")
  .option("--interval <seconds>", "Check interval in seconds", "300")
  .option("--max-checks <n>", "Max number of checks (0 = unlimited)", "0")
  .option("--morning", "Schedule for 7 AM release check")
  .option("--blitz", "Run morning blitz immediately (for testing)")
  .option("--nights <n>", "Number of nights for morning check", "1")
  .action(async (options) => {
    if (options.morning) {
      printHeader("Morning Release Monitor (7 AM Pacific)");
      await scheduleMorningCheck({
        parkName: options.park,
        partySize: parseInt(options.partySize),
        nights: parseInt(options.nights),
      });
      return;
    }

    if (options.blitz) {
      printHeader("Immediate Morning Blitz");
      await runImmediateBlitz({
        parkName: options.park,
        partySize: parseInt(options.partySize),
        nights: parseInt(options.nights),
      });
      return;
    }

    if (!options.start || !options.end) {
      console.error(
        "Error: --start and --end are required for continuous monitoring",
      );
      console.error("Use --morning for 7 AM release monitoring");
      process.exit(1);
    }

    printHeader(
      `Monitoring: "${options.park}" (${options.start} → ${options.end})`,
    );

    await startMonitor({
      parkName: options.park,
      startDate: parseDate(options.start),
      endDate: parseDate(options.end),
      partySize: parseInt(options.partySize),
      intervalSeconds: parseInt(options.interval),
      maxChecks: parseInt(options.maxChecks),
    });
  });
