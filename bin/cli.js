#!/usr/bin/env node
import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsx = join(__dirname, "..", "node_modules", ".bin", "tsx");
const entry = join(__dirname, "..", "src", "index.ts");

execFileSync(tsx, [entry], { stdio: "inherit", env: process.env });
