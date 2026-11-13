/**
 * Secret encryption at rest (spec §12; M4.B09).
 *
 * OAuth tokens and other credential secrets are sealed with AES-256-GCM before
 * they touch SQLite. The version tag keeps old ciphertexts readable if the
 * format changes; the key itself comes from the environment, never the database.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const CREDENTIAL_KEY_BYTES = 32;
export const CREDENTIAL_KEY_ENV = "BARTER_CREDENTIAL_KEY";

const FORMAT_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function decodeCredentialKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== CREDENTIAL_KEY_BYTES) {
    throw new Error(
      `Credential key must decode to ${CREDENTIAL_KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return key;
}

export function loadCredentialKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const encoded = env[CREDENTIAL_KEY_ENV];
  if (encoded === undefined || encoded === "") {
    throw new Error(`Missing ${CREDENTIAL_KEY_ENV}`);
  }
  return decodeCredentialKey(encoded);
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, ivPart, tagPart, ciphertextPart] = payload.split(".");
  if (
    version !== FORMAT_VERSION ||
    ivPart === undefined ||
    tagPart === undefined ||
    ciphertextPart === undefined
  ) {
    throw new Error("Unsupported encrypted secret format");
  }
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Malformed encrypted secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
