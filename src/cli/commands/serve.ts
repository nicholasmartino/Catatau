import { Command } from "commander";
import { startServer } from "../../server/api.js";
import { printHeader } from "../formatters.js";

export const serveCommand = new Command("serve")
  .description("Start the booking API server")
  .option("--port <port>", "Port to listen on", "3000")
  .action(async (options) => {
    printHeader("Camping Reso API Server");
    startServer(parseInt(options.port));
  });
