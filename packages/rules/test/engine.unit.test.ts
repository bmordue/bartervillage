import { describe, expect, it } from "vitest";

import { resolveTick } from "../src/engine.js";
import { testContent, testOrder, testPlayer, testWorldState } from "./fixtures.js";

describe("resolveTick entry point", () => {
  it("advances the tick, clears per-tick state and returns a state hash", () => {
    const state = testWorldState({
      ready: [{ playerId: "p1", tick: 5, position: 0 }],
      claims: [{ playerId: "p1", nodeId: "n1", tick: 5, sequence: 1 }],
    });
    const result = resolveTick({ state, content: testContent() });
    expect(result.state.world.currentTick).toBe(6);
    expect(result.state.ready).toEqual([]);
    expect(result.state.claims).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.header).toMatchObject({ v: 1, tick: 5, worldSeed: "seed-1" });
    expect(state.world.currentTick).toBe(5);
  });

  it("is deterministic for the same input", () => {
    const state = testWorldState({ orders: [testOrder()] });
    const a = resolveTick({ state, content: testContent() });
    const b = resolveTick({ state, content: testContent() });
    expect(a.stateHash).toBe(b.stateHash);
    expect(a.events).toEqual(b.events);
  });

  it("resolves a travel order and records the event", () => {
    const state = testWorldState({ orders: [testOrder()] });
    const result = resolveTick({ state, content: testContent() });
    expect(result.state.orders[0]?.status).toBe("resolved");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "order_resolved",
      payload: { orderId: "o1", playerId: "p1", orderType: "travel" },
    });
  });

  it("fails an order with no registered handler without changing other state", () => {
    const state = testWorldState({
      orders: [
        testOrder({ id: "o2", type: "plant", payload: { tile: { x: 1, y: 1 }, crop: "wheat" } }),
      ],
    });
    const result = resolveTick({ state, content: testContent() });
    expect(result.state.orders[0]?.status).toBe("failed");
    expect(result.state.orders[0]?.failureReason).toContain("No handler");
    expect(result.events[0]).toMatchObject({ type: "order_failed" });
  });

  it("excludes deadline and lease data from the state hash", () => {
    const base = testWorldState();
    const changedDeadline = testWorldState();
    changedDeadline.world.nextDeadline = "2027-01-01T00:00:00.000Z";
    changedDeadline.world.resolving = {
      owner: "worker",
      acquiredAt: "x",
      expiresAt: "y",
    };
    expect(resolveTick({ state: base, content: testContent() }).stateHash).toBe(
      resolveTick({ state: changedDeadline, content: testContent() }).stateHash,
    );
  });

  it("orders unready players by player ID", () => {
    const state = testWorldState({
      players: [testPlayer({ id: "p2" }), testPlayer({ id: "p1" })],
      orders: [
        testOrder({ id: "a", playerId: "p2", sequence: 1 }),
        testOrder({ id: "b", playerId: "p1", sequence: 1 }),
      ],
    });
    const result = resolveTick({ state, content: testContent() });
    expect(result.events.map((event) => event.payload)).toEqual([
      { orderId: "b", playerId: "p1", orderType: "travel" },
      { orderId: "a", playerId: "p2", orderType: "travel" },
    ]);
  });
});
