/**
 * Secret guard for the repository (spec §12; M4.B10).
 *
 * Infrastructure secrets live in deployment configuration (environment files or
 * the NixOS module), never in tracked files. This check fails CI if a private
 * key, an environment file, or a likely secret assignment is committed.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FORBIDDEN_FILES = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.[^/]+$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/,
  /\.(pem|key|p12|pfx)$/i,
];
const ALLOWED_FILES = [/(^|\/)\.env\.example$/];

const FORBIDDEN_CONTENT = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:client_secret|session_secret|vapid_private_key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
];

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const problems: string[] = [];

for (const file of files) {
  if (
    !ALLOWED_FILES.some((pattern) => pattern.test(file)) &&
    FORBIDDEN_FILES.some((pattern) => pattern.test(file))
  ) {
    problems.push(`${file}: secret-bearing file must not be tracked`);
    continue;
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const pattern of FORBIDDEN_CONTENT) {
    if (pattern.test(text)) {
      problems.push(`${file}: looks like it contains a secret (${pattern.source})`);
    }
  }
}

if (problems.length > 0) {
  console.error("Secret check failed:");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(`Secret check passed for ${files.length} tracked files.`);
