import { Command } from "commander";
import { findCampgrounds } from "../../availability/checker.js";
import { formatCampgroundTable, printHeader, printWarning } from "../formatters.js";

export const searchCommand = new Command("search")
  .description("Search for campgrounds by name")
  .argument("<name>", "Campground name to search for")
  .option("--json", "Output as JSON")
  .action(async (name: string, options) => {
    printHeader(`Search: "${name}"`);

    const results = await findCampgrounds(name);

    if (results.length === 0) {
      printWarning(`No campgrounds found matching "${name}"`);
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(formatCampgroundTable(results));
      console.log(`\nFound: ${results.length} campground(s)`);
    }
  });
