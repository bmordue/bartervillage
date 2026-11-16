import { describe, expect, it } from "vitest";

import { validateOrderDraft } from "../src/orderValidation.js";

describe("validateOrderDraft (M4.B04)", () => {
  it("accepts a valid tile order", () => {
    expect(() =>
      validateOrderDraft({
        type: "plant",
        payload: { tile: { x: 1, y: 2 }, crop: "wheat" },
      }),
    ).not.toThrow();
  });

  it("rejects missing order types", () => {
    expect(() => validateOrderDraft({ type: "", payload: {} })).toThrow(/Order type/);
  });

  it("rejects non-object payloads", () => {
    expect(() =>
      validateOrderDraft({ type: "plant", payload: [] as unknown as Record<string, unknown> }),
    ).toThrow(/payload/);
  });

  it("rejects tile orders without integer coordinates", () => {
    expect(() => validateOrderDraft({ type: "plant", payload: {} })).toThrow(/tile/);
    expect(() =>
      validateOrderDraft({ type: "plant", payload: { tile: { x: "1", y: 2 } } }),
    ).toThrow(/coordinates/);
  });
});
