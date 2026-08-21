#!/usr/bin/env node
import { main } from "../src/cli.js";

main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`rsh: ${message}`);
  if (process.env.RSH_DEBUG && error instanceof Error) console.error(error.stack);
  process.exitCode = 1;
});
