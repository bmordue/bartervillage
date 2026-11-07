import { describe, expect, it } from "vitest";

import { packageName } from "../src/index.js";

describe("unit runner", () => {
  it("loads the rules package", () => {
    expect(packageName).toBe("@bartervillage/rules");
  });
});
