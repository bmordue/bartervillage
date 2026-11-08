import { describe, expect, it } from "vitest";

import {
  advanceConstruction,
  isBuildingComplete,
  registerBuildingHandlers,
} from "../src/buildings.js";
import { EventLog } from "../src/events.js";
import { resolveOrder, type OrderExecutionContext } from "../src/orders.js";
import type {
  BuildPayload,
  BuildingDefinition,
  ContentPack,
  Order,
  UpgradePayload,
  WorldState,
} from "../src/types.js";
import { lockedQuantity, heldQuantity } from "../src/world.js";
import { testContent, testOrder, testWorldState } from "./fixtures.js";

registerBuildingHandlers();

const storehouse: BuildingDefinition = {
  id: "storehouse",
  name: "Storehouse",
  biomeLocks: null,
  maxLevel: 2,
  levels: [
    {
      level: 1,
      cost: [{ item: "wood", quantity: 5 }],
      energyCost: 3,
      durationTicks: 0,
      storageCapacity: 100,
      unlocksRecipes: [],
    },
    {
      level: 2,
      cost: [{ item: "stone", quantity: 2 }],
      energyCost: 4,
      durationTicks: 2,
      storageCapacity: 150,
      unlocksRecipes: [],
    },
  ],
};

const timber: BuildingDefinition = {
  id: "timber",
  name: "Timber yard",
  biomeLocks: null,
  maxLevel: 1,
  levels: [
    {
      level: 1,
      cost: [{ item: "wood", quantity: 3 }],
      energyCost: 2,
      durationTicks: 2,
      storageCapacity: 10,
      unlocksRecipes: [],
    },
  ],
};

const dock: BuildingDefinition = {
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

const shed: BuildingDefinition = {
  id: "shed",
  name: "Shed",
  biomeLocks: null,
  maxLevel: 1,
  levels: [
    {
      level: 1,
      cost: [],
      energyCost: 0,
      durationTicks: 2,
      storageCapacity: 0,
      unlocksRecipes: [],
    },
  ],
};

function content(buildings: BuildingDefinition[] = [storehouse]): ContentPack {
  return testContent({ buildings });
}

function runOrder(
  state: WorldState,
  pack: ContentPack,
  order: Order,
  events: EventLog = new EventLog(state.world.currentTick),
): { ok: boolean; reason: string | null; events: EventLog } {
  const player = state.players[0]!;
  const context = {
    state,
    content: pack,
    order,
    player,
    location: { regionId: "r1" },
    reachable: new Set(["r1"]),
    path: [],
    events,
  } as OrderExecutionContext & { events: EventLog };
  const outcome = resolveOrder(context);
  return { ok: outcome.ok, reason: outcome.reason, events };
}

function buildOrder(payload: BuildPayload, overrides: Partial<Order> = {}): Order {
  return testOrder({ id: "build-1", type: "build", payload, ...overrides } as Partial<Order>);
}

function upgradeOrder(payload: UpgradePayload, overrides: Partial<Order> = {}): Order {
  return testOrder({ id: "upgrade-1", type: "upgrade", payload, ...overrides } as Partial<Order>);
}

function tile(regionId: string, x: number, y: number, biome: string) {
  return {
    id: `tile-${regionId}-${x}-${y}`,
    regionId,
    x,
    y,
    type: "plot" as const,
    biome,
    traits: { soil: 50, water: 50, light: 50 },
  };
}

describe("buildings and construction", () => {
  it("builds an instant building, spends energy and consumes its cost", () => {
    const state = testWorldState({
      inventory: [{ plotId: "plot1", item: "wood", quantity: 10, locked: 0 }],
    });
    const result = runOrder(
      state,
      content(),
      buildOrder({ building: "storehouse", tile: { x: 0, y: 0 } }),
    );

    expect(result.ok).toBe(true);
    expect(state.buildings).toHaveLength(1);
    const building = state.buildings[0]!;
    expect(building.level).toBe(1);
    expect(building.constructionKind).toBeNull();
    expect(building.constructionCompleteTick).toBeNull();
    expect(isBuildingComplete(building)).toBe(true);
    expect(heldQuantity(state, "plot1", "wood")).toBe(5);
    expect(lockedQuantity(state, "plot1", "wood")).toBe(0);
    expect(state.players[0]?.energy).toBe(97);
    expect(result.events.events.map((event) => event.type)).toEqual([
      "construction_started",
      "construction_completed",
    ]);
  });

  it("starts a timed build at level 0 and completes it in advanceConstruction", () => {
    const state = testWorldState({
      inventory: [{ plotId: "plot1", item: "wood", quantity: 10, locked: 0 }],
    });
    const events = new EventLog(5);
    const result = runOrder(
      state,
      content([timber]),
      buildOrder({ building: "timber", tile: { x: 0, y: 0 } }),
      events,
    );

    expect(result.ok).toBe(true);
    const building = state.buildings[0]!;
    expect(building.level).toBe(0);
    expect(building.constructionKind).toBe("build");
    expect(building.constructionCompleteTick).toBe(7);
    expect(isBuildingComplete(building)).toBe(false);
    expect(heldQuantity(state, "plot1", "wood")).toBe(10);
    expect(lockedQuantity(state, "plot1", "wood")).toBe(3);
    expect(state.players[0]?.energy).toBe(98);
    expect(events.events.map((event) => event.type)).toEqual(["construction_started"]);

    advanceConstruction(state, content([timber]), new EventLog(5));
    expect(building.level).toBe(0);
    expect(lockedQuantity(state, "plot1", "wood")).toBe(3);

    state.world.currentTick = 7;
    const completion = new EventLog(7);
    advanceConstruction(state, content([timber]), completion);
    expect(building.level).toBe(1);
    expect(building.constructionKind).toBeNull();
    expect(building.constructionCompleteTick).toBeNull();
    expect(heldQuantity(state, "plot1", "wood")).toBe(7);
    expect(lockedQuantity(state, "plot1", "wood")).toBe(0);
    expect(completion.events).toHaveLength(1);
    expect(completion.events[0]).toMatchObject({
      type: "construction_completed",
      payload: { buildingId: building.id, kind: "build", completesTick: 7 },
    });
  });

  it("rejects biome-locked buildings without a matching plot tile", () => {
    const noTile = testWorldState();
    const missing = runOrder(
      noTile,
      content([dock]),
      buildOrder({ building: "dock", tile: { x: 0, y: 0 } }),
    );
    expect(missing.ok).toBe(false);
    expect(missing.reason).toContain("biome");
    expect(noTile.buildings).toHaveLength(0);

    const wrongBiome = testWorldState({ tiles: [tile("r1", 0, 0, "meadow")] });
    const wrong = runOrder(
      wrongBiome,
      content([dock]),
      buildOrder({ building: "dock", tile: { x: 0, y: 0 } }),
    );
    expect(wrong.ok).toBe(false);
    expect(wrongBiome.buildings).toHaveLength(0);

    const rightBiome = testWorldState({ tiles: [tile("r1", 0, 0, "riverside")] });
    const allowed = runOrder(
      rightBiome,
      content([dock]),
      buildOrder({ building: "dock", tile: { x: 0, y: 0 } }),
    );
    expect(allowed.ok).toBe(true);
    expect(rightBiome.buildings[0]?.type).toBe("dock");
  });

  it("allows buildings without biome locks when the plot has no tile", () => {
    const state = testWorldState({
      inventory: [{ plotId: "plot1", item: "wood", quantity: 10, locked: 0 }],
    });
    const result = runOrder(
      state,
      content(),
      buildOrder({ building: "storehouse", tile: { x: 0, y: 0 } }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects duplicate building types and a second construction on the plot", () => {
    const existing = testWorldState({
      buildings: [
        {
          id: "b1",
          plotId: "plot1",
          type: "storehouse",
          level: 1,
          constructionKind: null,
          constructionCompleteTick: null,
          craftQueue: [],
        },
      ],
    });
    const duplicate = runOrder(
      existing,
      content(),
      buildOrder({ building: "storehouse", tile: { x: 0, y: 0 } }),
    );
    expect(duplicate.ok).toBe(false);
    expect(duplicate.reason).toContain("already exists");

    const building = testWorldState({
      buildings: [
        {
          id: "b1",
          plotId: "plot1",
          type: "shed",
          level: 0,
          constructionKind: "build",
          constructionCompleteTick: 6,
          craftQueue: [],
        },
      ],
    });
    const second = runOrder(
      building,
      content([storehouse, shed]),
      buildOrder({ building: "storehouse", tile: { x: 0, y: 0 } }),
    );
    expect(second.ok).toBe(false);
    expect(second.reason).toContain("construction");
    expect(building.buildings).toHaveLength(1);
  });

  it("fails atomically when goods or energy are insufficient", () => {
    const poor = testWorldState({
      inventory: [{ plotId: "plot1", item: "wood", quantity: 1, locked: 0 }],
    });
    const missingGoods = runOrder(
      poor,
      content(),
      buildOrder({ building: "storehouse", tile: { x: 0, y: 0 } }),
    );
    expect(missingGoods.ok).toBe(false);
    expect(poor.buildings).toHaveLength(0);
    expect(heldQuantity(poor, "plot1", "wood")).toBe(1);
    expect(lockedQuantity(poor, "plot1", "wood")).toBe(0);
    expect(poor.players[0]?.energy).toBe(100);

    const tired = testWorldState({
      players: [{ ...testWorldState().players[0]!, energy: 2 }],
      inventory: [{ plotId: "plot1", item: "wood", quantity: 10, locked: 0 }],
    });
    const missingEnergy = runOrder(
      tired,
      content(),
      buildOrder({ building: "storehouse", tile: { x: 0, y: 0 } }),
    );
    expect(missingEnergy.ok).toBe(false);
    expect(tired.buildings).toHaveLength(0);
    expect(lockedQuantity(tired, "plot1", "wood")).toBe(0);
    expect(tired.players[0]?.energy).toBe(2);
  });

  it("queues a timed upgrade and completes it at the scheduled tick", () => {
    const state = testWorldState({
      inventory: [{ plotId: "plot1", item: "stone", quantity: 5, locked: 0 }],
      buildings: [
        {
          id: "b1",
          plotId: "plot1",
          type: "storehouse",
          level: 1,
          constructionKind: null,
          constructionCompleteTick: null,
          craftQueue: [],
        },
      ],
    });
    const events = new EventLog(5);
    const result = runOrder(state, content(), upgradeOrder({ buildingId: "b1" }), events);

    expect(result.ok).toBe(true);
    const building = state.buildings[0]!;
    expect(building.level).toBe(1);
    expect(building.constructionKind).toBe("upgrade");
    expect(building.constructionCompleteTick).toBe(7);
    expect(isBuildingComplete(building)).toBe(false);
    expect(lockedQuantity(state, "plot1", "stone")).toBe(2);
    expect(state.players[0]?.energy).toBe(96);
    expect(events.events.map((event) => event.type)).toEqual(["construction_started"]);

    state.world.currentTick = 6;
    advanceConstruction(state, content(), new EventLog(6));
    expect(building.level).toBe(1);

    state.world.currentTick = 7;
    const completion = new EventLog(7);
    advanceConstruction(state, content(), completion);
    expect(building.level).toBe(2);
    expect(building.constructionKind).toBeNull();
    expect(heldQuantity(state, "plot1", "stone")).toBe(3);
    expect(lockedQuantity(state, "plot1", "stone")).toBe(0);
    expect(completion.events[0]).toMatchObject({
      type: "construction_completed",
      payload: { kind: "upgrade", completesTick: 7 },
    });
  });

  it("completes zero-duration upgrades immediately", () => {
    const instantUpgrade: BuildingDefinition = {
      ...storehouse,
      levels: [storehouse.levels[0]!, { ...storehouse.levels[1]!, durationTicks: 0 }],
    };
    const state = testWorldState({
      inventory: [{ plotId: "plot1", item: "stone", quantity: 2, locked: 0 }],
      buildings: [
        {
          id: "b1",
          plotId: "plot1",
          type: "storehouse",
          level: 1,
          constructionKind: null,
          constructionCompleteTick: null,
          craftQueue: [],
        },
      ],
    });
    const events = new EventLog(5);
    const result = runOrder(
      state,
      content([instantUpgrade]),
      upgradeOrder({ buildingId: "b1" }),
      events,
    );

    expect(result.ok).toBe(true);
    expect(state.buildings[0]?.level).toBe(2);
    expect(state.buildings[0]?.constructionKind).toBeNull();
    expect(lockedQuantity(state, "plot1", "stone")).toBe(0);
    expect(heldQuantity(state, "plot1", "stone")).toBe(0);
    expect(events.events.map((event) => event.type)).toEqual([
      "construction_started",
      "construction_completed",
    ]);
  });

  it("rejects upgrades that are unknown, foreign, incomplete, busy or maxed", () => {
    const base = (): WorldState =>
      testWorldState({
        buildings: [
          {
            id: "b1",
            plotId: "plot1",
            type: "storehouse",
            level: 1,
            constructionKind: null,
            constructionCompleteTick: null,
            craftQueue: [],
          },
        ],
      });

    const unknown = runOrder(base(), content(), upgradeOrder({ buildingId: "nope" }));
    expect(unknown.ok).toBe(false);

    const foreign = base();
    foreign.buildings[0]!.plotId = "plot2";
    expect(runOrder(foreign, content(), upgradeOrder({ buildingId: "b1" })).ok).toBe(false);

    const incomplete = base();
    incomplete.buildings[0]!.constructionKind = "build";
    incomplete.buildings[0]!.constructionCompleteTick = 6;
    expect(runOrder(incomplete, content(), upgradeOrder({ buildingId: "b1" })).ok).toBe(false);

    const busy = base();
    busy.buildings[0]!.constructionKind = "upgrade";
    busy.buildings[0]!.constructionCompleteTick = 6;
    expect(runOrder(busy, content(), upgradeOrder({ buildingId: "b1" })).ok).toBe(false);

    const maxed = base();
    maxed.buildings[0]!.level = 2;
    expect(runOrder(maxed, content(), upgradeOrder({ buildingId: "b1" })).ok).toBe(false);
  });
});
