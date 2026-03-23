import { Command } from "commander";
import { listParksCommand } from "./commands/list-parks.js";
import { searchCommand } from "./commands/search.js";
import { listEquipmentCommand } from "./commands/list-equipment.js";
import { availabilityCommand } from "./commands/availability.js";
import { monitorCommand } from "./commands/monitor.js";
import { bookCommand } from "./commands/book.js";
import { serveCommand } from "./commands/serve.js";
import { snatchCommand } from "./commands/snatch.js";

export function createCli(): Command {
  const program = new Command();

  program
    .name("camping-reso")
    .description(
      "BC Parks camping reservation automation tool - front-run the competition",
    )
    .version("1.0.0");

  program.addCommand(listParksCommand);
  program.addCommand(searchCommand);
  program.addCommand(listEquipmentCommand);
  program.addCommand(availabilityCommand);
  program.addCommand(monitorCommand);
  program.addCommand(bookCommand);
  program.addCommand(serveCommand);
  program.addCommand(snatchCommand);

  return program;
}
