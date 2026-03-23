import { Command } from "commander";
import { runSnatcher } from "../../snatcher/snatcher.js";
import { printHeader } from "../formatters.js";
import { formatDate, getNextReleaseDate, msUntilNext7am } from "../../utils/dates.js";

export const snatchCommand = new Command("snatch")
  .description("Run the snatcher - starts 5 min before booking window, auto-books on release")
  .requiredOption("--park <name>", "Park/campground name")
  .option("--start <date>", "Start date (YYYY-MM-DD); defaults to next release date")
  .option("--end <date>", "End date (YYYY-MM-DD); defaults to start + nights")
  .option("--nights <n>", "Number of nights", "2")
  .option("--party-size <n>", "Party size", "2")
  .option("--pre-warm <minutes>", "Minutes before 7 AM to start", "5")
  .option("--headless", "Run browser in headless mode")
  .action(async (options) => {
    const releaseDate = getNextReleaseDate();
    const ms = msUntilNext7am();
    const hoursUntil = (ms / 3600000).toFixed(1);

    printHeader("Snatcher Mode");
    console.log(`Target park: ${options.park}`);
    console.log(`Target date: ${options.start || formatDate(releaseDate)} (next release)`);
    console.log(`Nights: ${options.nights}`);
    console.log(`Party size: ${options.partySize}`);
    console.log(`Pre-warm: ${options.preWarm} minutes before 7 AM`);
    console.log(`Next 7 AM Pacific: ${hoursUntil} hours from now\n`);

    await runSnatcher({
      parkName: options.park,
      startDate: options.start,
      endDate: options.end,
      nights: parseInt(options.nights),
      partySize: parseInt(options.partySize),
      headless: !!options.headless,
      preWarmMinutes: parseInt(options.preWarm),
    });
  });
