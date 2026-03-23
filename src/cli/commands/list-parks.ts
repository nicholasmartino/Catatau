import { Command } from "commander";
import { listAllCampgrounds } from "../../availability/checker.js";
import { formatCampgroundTable, printHeader } from "../formatters.js";

export const listParksCommand = new Command("list-parks")
  .description("List all reservable BC Parks campgrounds")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    printHeader("BC Parks Campgrounds");

    const campgrounds = await listAllCampgrounds();

    if (options.json) {
      console.log(JSON.stringify(campgrounds, null, 2));
    } else {
      console.log(formatCampgroundTable(campgrounds));
      console.log(`\nTotal: ${campgrounds.length} campgrounds`);
    }
  });
