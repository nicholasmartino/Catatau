import { Command } from "commander";
import { listEquipment } from "../../api/endpoints.js";
import { formatEquipmentTable, printHeader } from "../formatters.js";

export const listEquipmentCommand = new Command("list-equipment")
  .description("List all equipment categories (tent, RV, trailer, etc.)")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    printHeader("Equipment Categories");

    const equipment = await listEquipment();

    if (options.json) {
      console.log(JSON.stringify(equipment, null, 2));
    } else {
      console.log(formatEquipmentTable(equipment));
    }
  });
