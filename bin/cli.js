#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, "..", "package.json"));
const tsxEsm = require.resolve("tsx/esm");
const entry = join(__dirname, "..", "src", "index.ts");

execFileSync(process.execPath, ["--import", tsxEsm, entry], {
  stdio: "inherit",
  env: process.env,
});
