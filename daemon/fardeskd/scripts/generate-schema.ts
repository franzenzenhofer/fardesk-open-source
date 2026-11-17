import { resolve } from "node:path";
import { writeArtifacts } from "../src/contract/artifacts.js";

await writeArtifacts(resolve(import.meta.dirname, "..", "schema"));
