import { describe, expect, it } from "vitest";

import {
  appendOrder,
  cancelOrder,
  expandBatchOrder,
  findOrder,
  ordersOfPlayer,
  removeOrder,
  reorderQueue,
} from "../src/queue.js";
import { testWorldState } from "./fixtures.js";

describe("order queue model", () => {
  it("appends orders with monotonic sequences", () => {
    const state = testWorldState();
    const a = appendOrder(state, {
      id: "a",
      playerId: "p1",
      tick: 5,
      type: "travel",
      payload: { regionId: "r2" },
    });
    const b = appendOrder(state, {
      id: "b",
      playerId: "p1",
      tick: 5,
      type: "travel",
      payload: { regionId: "r1" },
    });
    expect(a.sequence).toBe(1);
    expect(b.sequence).toBe(2);
    expect(state.nextOrderSequence).toBe(3);
  });

  it("respects an explicit sequence and advances the counter", () => {
    const state = testWorldState({ nextOrderSequence: 1 });
    appendOrder(state, {
      id: "a",
      playerId: "p1",
      tick: 5,
      sequence: 10,
      type: "travel",
      payload: { regionId: "r2" },
    });
    expect(state.nextOrderSequence).toBe(11);
  });

  it("lists only live orders for a player and tick, in sequence order", () => {
    const state = testWorldState();
    appendOrder(state, {
      id: "a",
      playerId: "p1",
      tick: 5,
      sequence: 2,
      type: "travel",
      payload: { regionId: "r2" },
    });
    appendOrder(state, {
      id: "b",
      playerId: "p1",
      tick: 5,
      sequence: 1,
      type: "travel",
      payload: { regionId: "r1" },
    });
    appendOrder(state, {
      id: "c",
      playerId: "p1",
      tick: 6,
      sequence: 3,
      type: "travel",
      payload: { regionId: "r1" },
    });
    expect(ordersOfPlayer(state, "p1", 5).map((order) => order.id)).toEqual(["b", "a"]);
  });

  it("cancels queued orders but not resolved ones", () => {
    const state = testWorldState();
    appendOrder(state, {
      id: "a",
      playerId: "p1",
      tick: 5,
      type: "travel",
      payload: { regionId: "r2" },
    });
    expect(cancelOrder(state, "a")).toBe(true);
    expect(findOrder(state, "a")?.status).toBe("cancelled");
    expect(cancelOrder(state, "a")).toBe(false);
  });

  it("removes queued orders and refuses resolved ones", () => {
    const state = testWorldState();
    appendOrder(state, {
      id: "a",
      playerId: "p1",
      tick: 5,
      type: "travel",
      payload: { regionId: "r2" },
    });
    expect(removeOrder(state, "a")?.id).toBe("a");
    expect(findOrder(state, "a")).toBeUndefined();
  });

  it("reorders a queue and rejects incomplete or unknown lists", () => {
    const state = testWorldState();
    appendOrder(state, {
      id: "a",
      playerId: "p1",
      tick: 5,
      type: "travel",
      payload: { regionId: "r2" },
    });
    appendOrder(state, {
      id: "b",
      playerId: "p1",
      tick: 5,
      type: "travel",
      payload: { regionId: "r1" },
    });
    reorderQueue(state, "p1", 5, ["b", "a"]);
    expect(ordersOfPlayer(state, "p1", 5).map((order) => order.id)).toEqual(["b", "a"]);
    expect(() => reorderQueue(state, "p1", 5, ["b"])).toThrow();
    expect(() => reorderQueue(state, "p1", 5, ["b", "z"])).toThrow();
  });

  it("expands batch orders into independent per-unit orders", () => {
    const state = testWorldState();
    const orders = expandBatchOrder(
      state,
      {
        id: "batch",
        playerId: "p1",
        tick: 5,
        type: "plant",
        payload: { tile: { x: 0, y: 0 }, crop: "wheat" },
      },
      3,
      (_template, index) => ({ tile: { x: index, y: 0 }, crop: "wheat" }),
    );
    expect(orders.map((order) => order.id)).toEqual(["batch:0", "batch:1", "batch:2"]);
    expect(orders.map((order) => order.payload)).toEqual([
      { tile: { x: 0, y: 0 }, crop: "wheat" },
      { tile: { x: 1, y: 0 }, crop: "wheat" },
      { tile: { x: 2, y: 0 }, crop: "wheat" },
    ]);
  });
});
