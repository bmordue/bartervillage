/**
 * Deployment secret configuration (M9.03; spec §12).
 *
 * Secrets are supplied through the systemd environment file, never tracked in
 * the repository. The example file lists every key the services read.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const example = readFileSync(new URL(".env.example", root), "utf8");
const flake = readFileSync(new URL("flake.nix", root), "utf8");

const REQUIRED_KEYS = [
  "BARTER_CREDENTIAL_KEY",
  "BARTER_DISCORD_CLIENT_SECRET",
  "BARTER_GITHUB_CLIENT_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "BACKUP_S3_ENDPOINT",
  "BACKUP_S3_BUCKET",
  "BACKUP_S3_ACCESS_KEY_ID",
  "BACKUP_S3_SECRET_ACCESS_KEY",
  "BACKUP_WORK_DIR",
  "BACKUP_ENCRYPTION_PASSPHRASE",
];

describe("deployment secrets (M9.03)", () => {
  it("lists every secret key in the example environment file", () => {
    for (const key of REQUIRED_KEYS) {
      expect(example).toMatch(new RegExp(`^${key}=`, "m"));
    }
  });

  it("documents the systemd environment file as the secret source", () => {
    expect(flake).toContain("environmentFile");
    expect(flake).toContain("BARTER_CREDENTIAL_KEY");
    expect(flake).toContain("VAPID_PRIVATE_KEY");
    expect(flake).toContain("backup credentials");
  });
});
