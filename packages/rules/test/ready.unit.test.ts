import { describe, expect, it } from "vitest";
import { isReady, nextReadyPosition, ready, unready } from "../src/ready.js";
import { testWorldState } from "./fixtures.js";

describe("ready state", () => {
  it("assigns unique increasing positions per tick", () => {
    const state = testWorldState();
    expect(ready(state, "p1", 5).position).toBe(1);
    expect(ready(state, "p2", 5).position).toBe(2);
    expect(nextReadyPosition(state, 5)).toBe(3);
  });

  it("is idempotent for the same player and tick", () => {
    const state = testWorldState();
    const first = ready(state, "p1", 5);
    const second = ready(state, "p1", 5);
    expect(second).toEqual(first);
    expect(state.ready).toHaveLength(1);
  });

  it("allows a player to ready an empty queue", () => {
    const state = testWorldState({ orders: [] });
    ready(state, "p1", 5);
    expect(isReady(state, "p1", 5)).toBe(true);
  });

  it("sends a re-readied player to the back of the queue", () => {
    const state = testWorldState();
    expect(ready(state, "p1", 5).position).toBe(1);
    expect(ready(state, "p2", 5).position).toBe(2);
    expect(unready(state, "p1", 5)).toBe(true);
    expect(ready(state, "p1", 5).position).toBe(3);
  });

  it("ignores un-readying a player who is not ready", () => {
    const state = testWorldState();
    expect(unready(state, "p1", 5)).toBe(false);
  });

  it("tracks ticks independently", () => {
    const state = testWorldState();
    ready(state, "p1", 5);
    expect(isReady(state, "p1", 6)).toBe(false);
    expect(ready(state, "p1", 6).position).toBe(1);
  });
});
