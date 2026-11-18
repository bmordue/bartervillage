import { describe, expect, it } from "vitest";

import { validateOrderDraft } from "../src/orderValidation.js";

describe("validateOrderDraft (M4.B04, M5.B07)", () => {
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

  it("rejects an order the last polled energy cannot pay for", () => {
    expect(() =>
      validateOrderDraft(
        { type: "plant", payload: { tile: { x: 0, y: 0 }, crop: "wheat" } },
        { availableEnergy: 2, energyCost: 5 },
      ),
    ).toThrow(/Not enough energy/);
  });

  it("accepts an order when the energy cost fits or energy is unknown", () => {
    expect(() =>
      validateOrderDraft(
        { type: "plant", payload: { tile: { x: 0, y: 0 }, crop: "wheat" } },
        { availableEnergy: 10, energyCost: 5 },
      ),
    ).not.toThrow();
    expect(() =>
      validateOrderDraft({
        type: "plant",
        payload: { tile: { x: 0, y: 0 }, crop: "wheat" },
      }),
    ).not.toThrow();
  });

  it("does not enforce authoritative state such as capacity or locks", () => {
    expect(() =>
      validateOrderDraft(
        { type: "harvest", payload: { tile: { x: 9, y: 9 } } },
        { availableEnergy: 100, energyCost: 1 },
      ),
    ).not.toThrow();
  });
});
