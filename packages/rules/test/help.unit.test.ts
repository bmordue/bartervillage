import { describe, expect, it } from "vitest";

import { EventLog } from "../src/events.js";
import { registerHelpHandlers } from "../src/help.js";
import { resolveOrder, type OrderExecutionContext } from "../src/orders.js";
import type { Crop } from "../src/types.js";
import { testContent, testPlayer, testWorldState } from "./fixtures.js";
import { makeOrder } from "./support/harness.js";

const CONTENT = testContent({
  energy: {
    dailyBudget: 100,
    travelPerBoundary: 5,
    costs: {
      plant: 0,
      harvest: 0,
      tend: 0,
      feed: 0,
      build: 0,
      upgrade: 0,
      craft: 0,
      travel: 0,
      help: 1,
      gift: 0,
      forage: 0,
      fish: 0,
      post_offer: 0,
      post_wanted_request: 0,
      cancel_offer: 0,
      accept_offer: 0,
      counter_offer: 0,
      contribute_goal: 0,
      place_decoration: 0,
    },
  },
});

function twoPlotState(crops: Crop[] = []) {
  const state = testWorldState({ crops });
  state.players[0] = testPlayer({ id: "p1", plotId: "plot1", energy: 10 });
  state.players.push(testPlayer({ id: "p2", plotId: "plot2", energy: 100 }));
  state.plots.push({
    id: "plot2",
    playerId: "p2",
    regionId: "r1",
    siteX: 0,
    siteY: 1,
    width: 12,
    height: 12,
    worldOwned: false,
  });
  return state;
}

function makeContext(
  state: ReturnType<typeof testWorldState>,
  playerId: string,
  order: ReturnType<typeof makeOrder>,
): OrderExecutionContext {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error("missing player");
  }
  const context = {
    state,
    content: CONTENT,
    order,
    player,
    location: { regionId: "r1" },
    reachable: new Set<string>(["r1"]),
    path: [],
  } as OrderExecutionContext & { events?: EventLog };
  context.events = new EventLog();
  return context;
}

function crop(overrides: Partial<Crop> = {}): Crop {
  return {
    id: "c1",
    plotId: "plot2",
    tileX: 0,
    tileY: 0,
    type: "wheat",
    plantedTick: 1,
    growthTicks: 3,
    watered: false,
    tended: false,
    failed: false,
    ...overrides,
  };
}

describe("help order handler (M2.A16)", () => {
  it("rejects helping on your own plot", () => {
    registerHelpHandlers();
    const state = twoPlotState([crop()]);
    const order = makeOrder("help", { targetPlotId: "plot1", chore: "water" });

    const outcome = resolveOrder(makeContext(state, "p1", order));

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("own plot");
  });

  it("rejects unknown target plots", () => {
    registerHelpHandlers();
    const state = twoPlotState([crop()]);
    const order = makeOrder("help", { targetPlotId: "plot9", chore: "water" });

    const outcome = resolveOrder(makeContext(state, "p1", order));

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("not found");
  });

  it("spends the helper's energy, not the host's, and awards goodwill", () => {
    registerHelpHandlers();
    const state = twoPlotState([crop()]);
    const order = makeOrder("help", { targetPlotId: "plot2", chore: "water" });

    const outcome = resolveOrder(makeContext(state, "p1", order));

    expect(outcome.ok).toBe(true);
    expect(state.players.find((player) => player.id === "p1")?.energy).toBe(9);
    expect(state.players.find((player) => player.id === "p2")?.energy).toBe(100);
    expect(state.goodwill.find((entry) => entry.playerId === "p1")?.score).toBe(1);
  });

  it("waters the host's crop", () => {
    registerHelpHandlers();
    const state = twoPlotState([crop()]);
    const order = makeOrder("help", { targetPlotId: "plot2", chore: "water" });

    const outcome = resolveOrder(makeContext(state, "p1", order));

    expect(outcome.ok).toBe(true);
    expect(state.crops[0]?.watered).toBe(true);
  });

  it("tends the host's crop", () => {
    registerHelpHandlers();
    const state = twoPlotState([crop()]);
    const order = makeOrder("help", { targetPlotId: "plot2", chore: "tend" });

    const outcome = resolveOrder(makeContext(state, "p1", order));

    expect(outcome.ok).toBe(true);
    expect(state.crops[0]?.tended).toBe(true);
  });

  it("feeds the host's animal", () => {
    registerHelpHandlers();
    const state = twoPlotState();
    state.animals.push({
      id: "a1",
      plotId: "plot2",
      type: "chicken",
      count: 1,
      fed: false,
    });
    const order = makeOrder("help", { targetPlotId: "plot2", chore: "feed" });

    const outcome = resolveOrder(makeContext(state, "p1", order));

    expect(outcome.ok).toBe(true);
    expect(state.animals[0]?.fed).toBe(true);
  });

  it("fails when the host has nothing to help", () => {
    registerHelpHandlers();
    const state = twoPlotState();
    const order = makeOrder("help", { targetPlotId: "plot2", chore: "water" });

    const outcome = resolveOrder(makeContext(state, "p1", order));

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("No water target");
  });

  it("rejects a helper without enough energy", () => {
    registerHelpHandlers();
    const state = twoPlotState([crop()]);
    state.players[0] = testPlayer({ id: "p1", plotId: "plot1", energy: 0 });
    const order = makeOrder("help", { targetPlotId: "plot2", chore: "water" });

    const outcome = resolveOrder(makeContext(state, "p1", order));

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("Not enough energy");
  });
});
