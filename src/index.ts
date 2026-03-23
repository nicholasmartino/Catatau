#!/usr/bin/env node

import { createCli } from "./cli/index.js";

const program = createCli();
program.parseAsync(process.argv).catch((error) => {
  console.error("Fatal error:", error.message || error);
  process.exit(1);
});
