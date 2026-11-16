import { describe, expect, it } from "vitest";

import {
  CREDENTIAL_KEY_BYTES,
  CREDENTIAL_KEY_ENV,
  decodeCredentialKey,
  decryptSecret,
  encryptSecret,
  loadCredentialKey,
} from "../src/crypto.js";

const key = Buffer.alloc(CREDENTIAL_KEY_BYTES, 7);

describe("credential secret encryption", () => {
  it("round-trips a secret through AES-256-GCM", () => {
    const encrypted = encryptSecret("oauth-token-value", key);

    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(encrypted).not.toContain("oauth-token-value");
    expect(decryptSecret(encrypted, key)).toBe("oauth-token-value");
  });

  it("uses a fresh nonce for every encryption", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("rejects a different key", () => {
    const encrypted = encryptSecret("oauth-token-value", key);
    const other = Buffer.alloc(CREDENTIAL_KEY_BYTES, 8);

    expect(() => decryptSecret(encrypted, other)).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptSecret("oauth-token-value", key);
    const [version, iv, tag, ciphertext] = encrypted.split(".");
    const tamperedTag = `${tag!.startsWith("A") ? "B" : "A"}${tag!.slice(1)}`;

    expect(() => decryptSecret([version, iv, tamperedTag, ciphertext].join("."), key)).toThrow();
  });

  it("rejects an unknown format version", () => {
    expect(() => decryptSecret("v2.a.b.c", key)).toThrow(/Unsupported/);
  });

  it("validates the key length and environment variable", () => {
    expect(() => decodeCredentialKey(Buffer.alloc(16).toString("base64url"))).toThrow(/32 bytes/);
    expect(() => loadCredentialKey({})).toThrow(new RegExp(CREDENTIAL_KEY_ENV));
    expect(loadCredentialKey({ [CREDENTIAL_KEY_ENV]: key.toString("base64url") })).toEqual(key);
  });
});
