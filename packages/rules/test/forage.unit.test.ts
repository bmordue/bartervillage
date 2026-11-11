import { describe, expect, it } from "vitest";

import { EventLog } from "../src/events.js";
import {
  canForageNode,
  regrowWildNodes,
  registerForageHandlers,
  resolveWildClaims,
  splitShare,
} from "../src/forage.js";
import { resolveOrder } from "../src/orders.js";
import type { BuildingDefinition, ContentPack, Order, WildNode, WorldState } from "../src/types.js";
import { makeOrder, testContent, testPlayer, testWorldState } from "./support/harness.js";

function storehouseDefinition(capacity: number): BuildingDefinition {
  return {
    id: "storehouse",
    name: "Storehouse",
    biomeLocks: null,
    maxLevel: 1,
    levels: [
      {
        level: 1,
        cost: [],
        energyCost: 0,
        durationTicks: 0,
        storageCapacity: capacity,
        unlocksRecipes: [],
      },
    ],
  };
}

function storehouseBuilding(id: string, plotId: string) {
  return {
    id,
    plotId,
    type: "storehouse",
    level: 1,
    constructionKind: null,
    constructionCompleteTick: null,
    craftQueue: [],
  };
}

function dockDefinition(): BuildingDefinition {
  return {
    id: "dock",
    name: "Dock",
    biomeLocks: ["riverside", "coast"],
    maxLevel: 1,
    levels: [
      {
        level: 1,
        cost: [],
        energyCost: 0,
        durationTicks: 0,
        storageCapacity: 0,
        unlocksRecipes: [],
      },
    ],
  };
}

function dockBuilding(id: string, plotId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    plotId,
    type: "dock",
    level: 1,
    constructionKind: null,
    constructionCompleteTick: null,
    craftQueue: [],
    ...overrides,
  };
}

function forageContent(capacity = 100, forageCost = 5, fishCost = 4): ContentPack {
  const content = testContent({ buildings: [storehouseDefinition(capacity)] });
  content.energy.costs.forage = forageCost;
  content.energy.costs.fish = fishCost;
  return content;
}

function wildNode(overrides: Partial<WildNode> = {}): WildNode {
  return {
    id: "n1",
    regionId: "r1",
    x: 1,
    y: 1,
    resource: "berries",
    amount: 10,
    capacity: 20,
    regrowRate: 2,
    ...overrides,
  };
}

function forageState(overrides: Partial<WorldState> = {}): WorldState {
  return testWorldState({
    buildings: [storehouseBuilding("b1", "plot1")],
    wildNodes: [wildNode()],
    ...overrides,
  });
}

function multiPlayerState(count: number) {
  const players = Array.from({ length: count }, (_, index) =>
    testPlayer({ id: `p${index + 1}`, plotId: `plot${index + 1}` }),
  );
  const plots = players.map((player, index) => ({
    id: player.plotId,
    playerId: player.id,
    regionId: "r1",
    siteX: index,
    siteY: 0,
    width: 12,
    height: 12,
    worldOwned: false,
  }));
  const buildings = players.map((player, index) =>
    storehouseBuilding(`b${index + 1}`, player.plotId),
  );
  return { players, plots, buildings };
}

function runOrder(
  state: WorldState,
  content: ContentPack,
  order: Order,
  regionId = "r1",
): { ok: boolean; reason: string | null } {
  const player = state.players.find((candidate) => candidate.id === order.playerId);
  if (!player) {
    throw new Error(`Missing player ${order.playerId}`);
  }
  return resolveOrder({
    state,
    content,
    order,
    player,
    location: { regionId },
    reachable: new Set([regionId]),
    path: [],
  });
}

describe("wild-node regrowth", () => {
  it("regrows nodes up to capacity in node-id order and only emits increases", () => {
    const state = testWorldState({
      wildNodes: [
        wildNode({ id: "n2", amount: 1, capacity: 5, regrowRate: 9 }),
        wildNode({ id: "n1", amount: 2, capacity: 10, regrowRate: 3 }),
      ],
    });

    const events = new EventLog(5);
    regrowWildNodes(state, events);

    expect(state.wildNodes.find((node) => node.id === "n1")?.amount).toBe(5);
    expect(state.wildNodes.find((node) => node.id === "n2")?.amount).toBe(5);
    expect(events.events).toEqual([
      {
        tick: 5,
        sequence: 0,
        version: 1,
        type: "node_regrown",
        payload: { nodeId: "n1", resource: "berries", amount: 5 },
      },
      {
        tick: 5,
        sequence: 1,
        version: 1,
        type: "node_regrown",
        payload: { nodeId: "n2", resource: "berries", amount: 5 },
      },
    ]);

    const second = new EventLog(5);
    regrowWildNodes(state, second);
    expect(state.wildNodes.find((node) => node.id === "n1")?.amount).toBe(8);
    expect(state.wildNodes.find((node) => node.id === "n2")?.amount).toBe(5);
    expect(second.events.map((event) => event.type)).toEqual(["node_regrown"]);
    expect(second.events[0]?.payload).toEqual({
      nodeId: "n1",
      resource: "berries",
      amount: 8,
    });
  });
});

describe("forage and fish claims", () => {
  it("reserves energy and records a claim without applying yield", () => {
    registerForageHandlers();
    const content = forageContent();
    const state = forageState();
    const order = makeOrder("forage", { nodeId: "n1" }, { sequence: 7 });
    const player = state.players[0]!;

    expect(canForageNode(state, "n1", player)).toBe(true);
    const outcome = runOrder(state, content, order);

    expect(outcome).toEqual({ ok: true, reason: null });
    expect(player.energy).toBe(95);
    expect(state.claims).toEqual([{ playerId: "p1", nodeId: "n1", tick: 5, sequence: 7 }]);
    expect(state.inventory).toEqual([]);
    expect(state.wildNodes[0]?.amount).toBe(10);
    expect(canForageNode(state, "n1", player)).toBe(false);
  });

  it("rejects a duplicate claim by the same player on the same node in the same tick", () => {
    registerForageHandlers();
    const content = forageContent();
    const state = forageState({
      claims: [{ playerId: "p1", nodeId: "n1", tick: 5, sequence: 1 }],
    });
    const order = makeOrder("forage", { nodeId: "n1" }, { sequence: 2 });
    const player = state.players[0]!;

    const outcome = runOrder(state, content, order);

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("already claimed");
    expect(player.energy).toBe(100);
    expect(state.claims).toEqual([{ playerId: "p1", nodeId: "n1", tick: 5, sequence: 1 }]);
  });

  it("fails a forage claim outside the node's region", () => {
    registerForageHandlers();
    const state = forageState();
    const order = makeOrder("forage", { nodeId: "n1" });

    const outcome = runOrder(state, forageContent(), order, "r2");

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("not in region");
    expect(state.players[0]?.energy).toBe(100);
    expect(state.claims).toEqual([]);
  });

  it("allows fishing only on a water tile or a fish node", () => {
    registerForageHandlers();
    const content = forageContent();
    const order = makeOrder("fish", { nodeId: "n1" });

    const dry = forageState({ tiles: [], wildNodes: [wildNode({ resource: "berries" })] });
    expect(runOrder(dry, content, order).ok).toBe(false);
    expect(dry.players[0]?.energy).toBe(100);

    const wet = forageState({
      tiles: [
        {
          id: "t1",
          regionId: "r1",
          x: 0,
          y: 0,
          type: "water",
          biome: "river",
          traits: { soil: 0, water: 1, light: 0 },
        },
      ],
      wildNodes: [wildNode({ resource: "berries" })],
    });
    expect(runOrder(wet, content, order).ok).toBe(true);
    expect(wet.players[0]?.energy).toBe(96);

    const fishNode = forageState({ tiles: [], wildNodes: [wildNode({ resource: "fish" })] });
    expect(runOrder(fishNode, content, order).ok).toBe(true);
    expect(fishNode.players[0]?.energy).toBe(96);
  });
});

describe("dock fishing (M2.C09)", () => {
  function dockContent(capacity = 100, fishCost = 4): ContentPack {
    const content = testContent({
      buildings: [storehouseDefinition(capacity), dockDefinition()],
    });
    content.energy.costs.fish = fishCost;
    return content;
  }

  it("is private: applies the catch immediately, spends fish energy and records no claim", () => {
    registerForageHandlers();
    const content = dockContent();
    const state = forageState({
      buildings: [storehouseBuilding("b1", "plot1"), dockBuilding("d1", "plot1")],
    });
    const player = state.players[0]!;
    const order = makeOrder("fish", { buildingId: "d1" }, { sequence: 1 });

    expect(runOrder(state, content, order)).toEqual({ ok: true, reason: null });

    expect(player.energy).toBe(96);
    expect(state.inventory).toEqual([{ plotId: "plot1", item: "fish", quantity: 1, locked: 0 }]);
    expect(state.claims).toEqual([]);
  });

  it("does not split the catch between dock fishers", () => {
    registerForageHandlers();
    const content = dockContent();
    const state = forageState({
      buildings: [
        storehouseBuilding("b1", "plot1"),
        dockBuilding("d1", "plot1"),
        storehouseBuilding("b2", "plot2"),
        dockBuilding("d2", "plot2"),
        storehouseBuilding("b3", "plot3"),
        dockBuilding("d3", "plot3"),
      ],
    });
    state.players = [
      ...state.players,
      testPlayer({ id: "p2", plotId: "plot2" }),
      testPlayer({ id: "p3", plotId: "plot3" }),
    ];
    state.plots = [
      ...state.plots,
      { ...state.plots[0]!, id: "plot2", playerId: "p2", siteX: 1 },
      { ...state.plots[0]!, id: "plot3", playerId: "p3", siteX: 2 },
    ];

    for (const [playerId, dockId] of [
      ["p1", "d1"],
      ["p2", "d2"],
      ["p3", "d3"],
    ] as const) {
      const order = makeOrder("fish", { buildingId: dockId }, { playerId });
      expect(runOrder(state, content, order)).toEqual({ ok: true, reason: null });
    }

    expect(state.inventory.map((row) => [row.plotId, row.quantity])).toEqual([
      ["plot1", 1],
      ["plot2", 1],
      ["plot3", 1],
    ]);
    expect(state.claims).toEqual([]);
  });

  it("rejects a dock that belongs to another plot", () => {
    registerForageHandlers();
    const content = dockContent();
    const state = forageState({
      buildings: [storehouseBuilding("b1", "plot1"), dockBuilding("d1", "plot2")],
    });
    const order = makeOrder("fish", { buildingId: "d1" });

    const outcome = runOrder(state, content, order);

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("inaccessible dock");
    expect(state.players[0]?.energy).toBe(100);
    expect(state.inventory).toEqual([]);
  });

  it("rejects an incomplete dock", () => {
    registerForageHandlers();
    const content = dockContent();
    const state = forageState({
      buildings: [
        storehouseBuilding("b1", "plot1"),
        dockBuilding("d1", "plot1", { constructionKind: "build" }),
      ],
    });
    const order = makeOrder("fish", { buildingId: "d1" });

    const outcome = runOrder(state, content, order);

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("not yet complete");
    expect(state.players[0]?.energy).toBe(100);
  });

  it("fails when there is no free storage for the catch", () => {
    registerForageHandlers();
    const content = dockContent(0);
    const state = forageState({
      buildings: [storehouseBuilding("b1", "plot1"), dockBuilding("d1", "plot1")],
    });
    const order = makeOrder("fish", { buildingId: "d1" });

    const outcome = runOrder(state, content, order);

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("storage");
    expect(state.players[0]?.energy).toBe(100);
    expect(state.inventory).toEqual([]);
  });
});

describe("wild-claim resolution", () => {
  it("splits floor shares and leaves the remainder on the node", () => {
    expect(splitShare(10, 3)).toBe(3);
    expect(splitShare(2, 3)).toBe(0);
    expect(splitShare(10, 0)).toBe(0);

    const { players, plots, buildings } = multiPlayerState(3);
    const state = forageState({
      players,
      plots,
      buildings,
      wildNodes: [wildNode({ amount: 10 })],
      claims: [
        { playerId: "p3", nodeId: "n1", tick: 5, sequence: 3 },
        { playerId: "p1", nodeId: "n1", tick: 5, sequence: 1 },
        { playerId: "p2", nodeId: "n1", tick: 5, sequence: 2 },
      ],
    });
    const events = new EventLog(5);

    resolveWildClaims(state, forageContent(), events);

    expect(state.inventory.map((row) => [row.plotId, row.item, row.quantity])).toEqual([
      ["plot1", "berries", 3],
      ["plot2", "berries", 3],
      ["plot3", "berries", 3],
    ]);
    expect(state.wildNodes[0]?.amount).toBe(1);
    expect(state.claims).toEqual([]);
    expect(events.events).toEqual([]);
  });

  it("caps shares by free storage and leaves overflow on the node", () => {
    const state = forageState({
      buildings: [storehouseBuilding("b1", "plot1")],
      wildNodes: [wildNode({ amount: 10 })],
      claims: [{ playerId: "p1", nodeId: "n1", tick: 5, sequence: 1 }],
    });
    const events = new EventLog(5);

    resolveWildClaims(state, forageContent(2), events);

    expect(state.inventory).toEqual([{ plotId: "plot1", item: "berries", quantity: 2, locked: 0 }]);
    expect(state.wildNodes[0]?.amount).toBe(8);
    expect(events.events).toEqual([]);
  });

  it("emits node_depleted when claims bring the node to zero", () => {
    const { players, plots, buildings } = multiPlayerState(2);
    const state = forageState({
      players,
      plots,
      buildings,
      wildNodes: [wildNode({ amount: 2 })],
      claims: [
        { playerId: "p2", nodeId: "n1", tick: 5, sequence: 2 },
        { playerId: "p1", nodeId: "n1", tick: 5, sequence: 1 },
      ],
    });
    const events = new EventLog(5);

    resolveWildClaims(state, forageContent(), events);

    expect(state.wildNodes[0]?.amount).toBe(0);
    expect(state.inventory.map((row) => row.quantity)).toEqual([1, 1]);
    expect(events.events).toEqual([
      {
        tick: 5,
        sequence: 0,
        version: 1,
        type: "node_depleted",
        payload: { nodeId: "n1", resource: "berries", amount: 0 },
      },
    ]);
  });

  it("keeps one claimant per player per node even if duplicate claims are present", () => {
    const state = forageState({
      wildNodes: [wildNode({ amount: 4 })],
      claims: [
        { playerId: "p1", nodeId: "n1", tick: 5, sequence: 1 },
        { playerId: "p1", nodeId: "n1", tick: 5, sequence: 2 },
      ],
    });

    resolveWildClaims(state, forageContent(), new EventLog(5));

    expect(state.players[0]?.id).toBe("p1");
    expect(state.inventory).toEqual([{ plotId: "plot1", item: "berries", quantity: 4, locked: 0 }]);
    expect(state.wildNodes[0]?.amount).toBe(0);
  });
});
