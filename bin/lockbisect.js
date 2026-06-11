#!/usr/bin/env node
import { main } from "../src/cli.js";

main().catch((err) => {
  process.stderr.write(`lockbisect: ${err?.stack || err}\n`);
  process.exit(2);
});
