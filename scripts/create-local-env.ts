/**
 * Create a local development environment file from the shared template.
 *
 * Writes `./.env` with local-only values (development world `w1`, localhost
 * WebAuthn origin, local SQLite path). Refuses to overwrite an existing file.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateVAPIDKeys } from "web-push";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const templatePath = fileURLToPath(new URL("../.env.example", import.meta.url));

if (existsSync(envPath)) {
  console.log(".env already exists; nothing to do. Delete it to regenerate.");
  process.exit(0);
}

const template = readFileSync(templatePath, "utf8");
const vapid = generateVAPIDKeys();

const localEnv = template
  .split(/\r?\n/)
  .map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("PORT=")) {
      return "PORT=3000";
    }
    if (trimmed.startsWith("HOST=")) {
      return "HOST=127.0.0.1";
    }
    if (trimmed.startsWith("DATABASE_PATH=")) {
      return "DATABASE_PATH=./barter-village.sqlite";
    }
    if (trimmed.startsWith("WORLD_ID=")) {
      return "WORLD_ID=w1";
    }
    if (trimmed.startsWith("BARTER_RP_ID=")) {
      return "BARTER_RP_ID=localhost";
    }
    if (trimmed.startsWith("BARTER_ORIGIN=")) {
      return "BARTER_ORIGIN=http://localhost:5173";
    }
    if (trimmed.startsWith("NODE_ENV=")) {
      return "NODE_ENV=development";
    }
    if (trimmed.startsWith("VAPID_PUBLIC_KEY=")) {
      return `VAPID_PUBLIC_KEY=${vapid.publicKey}`;
    }
    if (trimmed.startsWith("VAPID_PRIVATE_KEY=")) {
      return `VAPID_PRIVATE_KEY=${vapid.privateKey}`;
    }
    if (trimmed.startsWith("BACKUP_") || trimmed.startsWith("BARTER_")) {
      // Keep deployment-only keys and secret placeholders from the template.
      return trimmed;
    }
    return line;
  })
  .join("\n");

writeFileSync(envPath, localEnv);

console.log(`Wrote local environment file to ${envPath}`);
console.log("Next steps:");
console.log("  npx tsx scripts/seed-local.ts");
console.log("  npm start --workspace @bartervillage/server");
console.log("  npm run dev --workspace @bartervillage/client");
