/**
 * Validate the shipped content pack in CI (spec §12; M8.08).
 *
 * The validator is the same one the rules package uses at runtime, so CI fails
 * on malformed content before it can be pinned to a world.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { validateContent } from "../packages/rules/src/content.js";

const contentPath = fileURLToPath(new URL("../packages/content/content.json", import.meta.url));
const raw = JSON.parse(readFileSync(contentPath, "utf8")) as Record<string, unknown>;
const result = validateContent(raw);

if (!result.ok) {
  console.error("Invalid content pack:");
  for (const error of result.errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log(`Content pack ${result.content.version} is valid.`);
