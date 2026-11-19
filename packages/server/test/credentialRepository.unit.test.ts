import { afterEach, describe, expect, it } from "vitest";

import { CREDENTIAL_KEY_BYTES } from "../src/crypto.js";
import {
  createCredential,
  deleteCredential,
  deletePlayerCredentials,
  findCredentialBySubject,
  listPlayerCredentials,
  loadCredential,
  loadCredentialSecret,
} from "../src/db/credentialRepository.js";
import { Database } from "../src/db/database.js";

const key = Buffer.alloc(CREDENTIAL_KEY_BYTES, 7);
const otherKey = Buffer.alloc(CREDENTIAL_KEY_BYTES, 8);

let db: Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function setup(): Database {
  const database = Database.open();
  db = database;
  database.run(
    "INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES ('p1', 'Ada', 'plot1', 0, 100)",
  );
  database.run(
    "INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES ('p2', 'Bo', 'plot2', 0, 100)",
  );
  return database;
}

describe("credential persistence", () => {
  it("stores only encrypted secrets", () => {
    const database = setup();

    const credential = createCredential(
      database,
      {
        id: "c1",
        playerId: "p1",
        kind: "discord",
        subject: "discord:123",
        secret: "oauth-token-value",
      },
      key,
    );

    expect(credential.secretCiphertext).not.toBeNull();
    expect(credential.secretCiphertext).not.toContain("oauth-token-value");
    const row = database.get<{ secret_ciphertext: string }>(
      "SELECT secret_ciphertext FROM credentials WHERE id = 'c1'",
    );
    expect(row?.secret_ciphertext).not.toContain("oauth-token-value");
    expect(loadCredentialSecret(database, "c1", key)).toBe("oauth-token-value");
  });

  it("keeps credentials without a secret unencrypted and null", () => {
    const database = setup();

    createCredential(
      database,
      { id: "c1", playerId: "p1", kind: "passkey", subject: "credential-id" },
      key,
    );

    expect(loadCredential(database, "c1")?.secretCiphertext).toBeNull();
    expect(loadCredentialSecret(database, "c1", key)).toBeNull();
    expect(loadCredentialSecret(database, "missing", key)).toBeUndefined();
  });

  it("fails to decrypt with the wrong key", () => {
    const database = setup();
    createCredential(
      database,
      { id: "c1", playerId: "p1", kind: "github", subject: "github:42", secret: "token" },
      key,
    );

    expect(() => loadCredentialSecret(database, "c1", otherKey)).toThrow();
  });

  it("allows one identity per kind and subject", () => {
    const database = setup();
    const options = {
      id: "c1",
      playerId: "p1",
      kind: "discord" as const,
      subject: "discord:123",
      secret: "token",
    };

    createCredential(database, options, key);

    expect(() => createCredential(database, { ...options, id: "c2" }, key)).toThrow();
    expect(findCredentialBySubject(database, "discord", "discord:123")?.id).toBe("c1");
  });

  it("lists multiple credentials for one player and deletes them", () => {
    const database = setup();
    createCredential(
      database,
      { id: "c1", playerId: "p1", kind: "discord", subject: "discord:123" },
      key,
    );
    createCredential(
      database,
      { id: "c2", playerId: "p1", kind: "github", subject: "github:42" },
      key,
    );

    expect(listPlayerCredentials(database, "p1").map((credential) => credential.id)).toEqual([
      "c1",
      "c2",
    ]);
    expect(deleteCredential(database, "c1")).toBe(true);
    expect(deleteCredential(database, "c1")).toBe(false);
    expect(loadCredential(database, "c1")).toBeUndefined();
  });

  it("deletes all credentials for a player at once", () => {
    const database = setup();
    createCredential(
      database,
      { id: "c1", playerId: "p1", kind: "discord", subject: "discord:123" },
      key,
    );
    createCredential(
      database,
      { id: "c2", playerId: "p1", kind: "github", subject: "github:42" },
      key,
    );
    createCredential(
      database,
      { id: "c3", playerId: "p2", kind: "discord", subject: "discord:777" },
      key,
    );

    expect(deletePlayerCredentials(database, "p1")).toBe(true);
    expect(listPlayerCredentials(database, "p1")).toHaveLength(0);
    expect(listPlayerCredentials(database, "p2")).toHaveLength(1);
  });
});
