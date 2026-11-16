import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE_DIR = fileURLToPath(new URL("../src", import.meta.url));
const ENTRY_HTML = fileURLToPath(new URL("../index.html", import.meta.url));
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
const CURRENCY_OR_COIN =
  /\b(currenc(?:y|ies)|coins?|money|cash|gold|silver|dollars?|credits?|wallets?|balances?|prices?)\b/i;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

describe("client currency guard", () => {
  it("contains no currency or coin concept in UI source", () => {
    const files = [...sourceFiles(SOURCE_DIR), ENTRY_HTML];

    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(CURRENCY_OR_COIN);
    }
  });
});
