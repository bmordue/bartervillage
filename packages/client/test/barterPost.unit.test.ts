/**
 * Unit tests for the offer and wanted-request flows (M6.02).
 */

import { describe, expect, it } from "vitest";

import {
  createOfferOrder,
  createStack,
  createWantedRequestOrder,
  DEFAULT_EXPIRY_TICKS,
  validatePostExpiry,
} from "../src/barter.js";

describe("createStack (M6.02)", () => {
  it("trims the item name and keeps the quantity", () => {
    expect(createStack("  wheat  ", 3)).toEqual({ item: "wheat", quantity: 3 });
  });

  it("rejects a blank item", () => {
    expect(() => createStack("   ", 1)).toThrow("Choose an item");
  });

  it("rejects non-positive and fractional quantities", () => {
    expect(() => createStack("wheat", 0)).toThrow("positive whole number");
    expect(() => createStack("wheat", 1.5)).toThrow("positive whole number");
  });
});

describe("validatePostExpiry (M6.02)", () => {
  it("accepts the whole 1 to 28 tick range", () => {
    expect(() => validatePostExpiry(1)).not.toThrow();
    expect(() => validatePostExpiry(28)).not.toThrow();
  });

  it("rejects values outside the range or not whole ticks", () => {
    expect(() => validatePostExpiry(0)).toThrow("1 to 28");
    expect(() => validatePostExpiry(29)).toThrow("1 to 28");
    expect(() => validatePostExpiry(2.5)).toThrow("1 to 28");
  });
});

describe("createOfferOrder (M6.02)", () => {
  it("builds a post_offer order with both sides and the expiry", () => {
    expect(
      createOfferOrder({
        gives: [{ item: "wheat", quantity: 2 }],
        wants: [{ item: "wood", quantity: 1 }],
        expiryTicks: 7,
      }),
    ).toEqual({
      type: "post_offer",
      payload: {
        gives: [{ item: "wheat", quantity: 2 }],
        wants: [{ item: "wood", quantity: 1 }],
        expiryTicks: 7,
      },
    });
  });

  it("requires goods on both sides", () => {
    expect(() =>
      createOfferOrder({ gives: [], wants: [{ item: "wood", quantity: 1 }], expiryTicks: 7 }),
    ).toThrow("at least one item");
    expect(() =>
      createOfferOrder({ gives: [{ item: "wheat", quantity: 1 }], wants: [], expiryTicks: 7 }),
    ).toThrow("at least one item");
  });

  it("rejects an invalid expiry", () => {
    expect(() =>
      createOfferOrder({
        gives: [{ item: "wheat", quantity: 1 }],
        wants: [{ item: "wood", quantity: 1 }],
        expiryTicks: 0,
      }),
    ).toThrow("1 to 28");
  });
});

describe("createWantedRequestOrder (M6.02)", () => {
  it("builds a post_wanted_request order with a quantity and expiry", () => {
    expect(
      createWantedRequestOrder({
        wants: [{ item: "wood", quantity: 4 }],
        quantity: 2,
        expiryTicks: DEFAULT_EXPIRY_TICKS,
      }),
    ).toEqual({
      type: "post_wanted_request",
      payload: {
        wants: [{ item: "wood", quantity: 4 }],
        quantity: 2,
        expiryTicks: 7,
      },
    });
  });

  it("rejects a non-positive request quantity", () => {
    expect(() =>
      createWantedRequestOrder({
        wants: [{ item: "wood", quantity: 1 }],
        quantity: 0,
        expiryTicks: 7,
      }),
    ).toThrow("positive whole number");
  });
});
