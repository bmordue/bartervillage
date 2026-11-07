import { describe, expect, it } from "vitest";

import {
  RULES_VERSION,
  VersionMismatchError,
  assertCompatibleVersions,
  makeTickHeader,
  tickSeedParts,
} from "../src/versions.js";

const versions = {
  generatorVersion: "gen-1",
  contentVersion: "content-1",
  rulesVersion: RULES_VERSION,
};

describe("version identities", () => {
  it("includes all versions and the schema version in the tick header", () => {
    const header = makeTickHeader({ ...versions, worldSeed: 123, tick: 4 });
    expect(header).toEqual({
      v: 1,
      worldSeed: "123",
      tick: 4,
      generatorVersion: "gen-1",
      contentVersion: "content-1",
      rulesVersion: RULES_VERSION,
    });
  });

  it("derives the RNG seed tuple from the header", () => {
    const header = makeTickHeader({ ...versions, worldSeed: "abc", tick: 2 });
    expect(tickSeedParts(header)).toEqual(["abc", 2, "gen-1", "content-1", RULES_VERSION]);
  });

  it("rejects invalid headers", () => {
    expect(() => makeTickHeader({ ...versions, worldSeed: "x", tick: -1 })).toThrow(
      VersionMismatchError,
    );
    expect(() =>
      makeTickHeader({ ...versions, worldSeed: "x", tick: 1, contentVersion: "" }),
    ).toThrow(VersionMismatchError);
  });

  it("detects incompatible pinned versions", () => {
    expect(() => assertCompatibleVersions(versions, versions)).not.toThrow();
    expect(() =>
      assertCompatibleVersions(versions, { ...versions, contentVersion: "content-2" }),
    ).toThrow(VersionMismatchError);
  });
});
