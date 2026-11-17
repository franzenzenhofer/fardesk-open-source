#!/usr/bin/env node
import { runMain } from "./cli/bin.js";

process.exitCode = await runMain(process.argv.slice(2), process);
