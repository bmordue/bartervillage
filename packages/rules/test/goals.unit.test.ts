import { describe, expect, it } from "vitest";

import { isRecipeUnlocked } from "../src/crafting.js";
import { EventLog } from "../src/events.js";
import {
  createGoal,
  expireGoal,
  goalProgress,
  goalStatusAt,
  nextGoalDefinition,
  registerGoalHandlers,
  succeedGoal,
} from "../src/goals.js";
import { preLockedItems, queueOrder } from "../src/locking.js";
import { resolveOrder, type OrderExecutionContext } from "../src/orders.js";
import { cancelOrder, removeOrder } from "../src/queue.js";
import type {
  ContentPack,
  ContributeGoalPayload,
  Goal,
  GoalDefinition,
  Order,
  RecipeDefinition,
  WorldState,
} from "../src/types.js";
import { testContent, testOrder, testWorldState } from "./fixtures.js";
import { runTick } from "./support/harness.js";

registerGoalHandlers();

const goalDefinition: GoalDefinition = {
  id: "barn_raising",
  kind: "collective_build",
  title: "Raise the barn",
  requires: [
    { item: "grain", quantity: 5 },
    { item: "wood", quantity: 2 },
  ],
  rewards: [{ kind: "building", id: "barn" }],
  durationTicks: 3,
};

function activeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    ...createGoal(goalDefinition, 5),
    ...overrides,
  };
}

function contributeOrder(payload: ContributeGoalPayload): Order {
  return testOrder({
    id: "goal-order-1",
    type: "contribute_goal",
    payload,
  } as Partial<Order>);
}

function stateWithGoal(overrides: Partial<WorldState> = {}): WorldState {
  return testWorldState({
    goals: [activeGoal()],
    inventory: [
      { plotId: "plot1", item: "grain", quantity: 10, locked: 0 },
      { plotId: "plot1", item: "wood", quantity: 5, locked: 0 },
    ],
    ...overrides,
  });
}

function runOrder(
  state: WorldState,
  content: ContentPack,
  order: Order,
  events: EventLog = new EventLog(state.world.currentTick),
): { ok: boolean; reason: string | null; events: EventLog } {
  const player = state.players[0]!;
  const context = {
    state,
    content,
    order,
    player,
    location: { regionId: "r1" },
    reachable: new Set(["r1"]),
    path: [],
    events,
  } as OrderExecutionContext & { events: EventLog };
  return { ...resolveOrder(context), events };
}

describe("goal scheduling", () => {
  it("creates an active goal with a deadline from its duration", () => {
    const goal = createGoal(goalDefinition, 5);

    expect(goal).toMatchObject({
      id: "barn_raising",
      createdAtTick: 5,
      deadlineTick: 8,
      status: "active",
    });
    expect(goal.requires).not.toBe(goalDefinition.requires);
  });

  it("picks the next unused definition only when no goal is active", () => {
    const other = { ...goalDefinition, id: "harvest_festival", kind: "festival" as const };
    const content = testContent({ goals: [goalDefinition, other] });

    expect(nextGoalDefinition(testWorldState(), content)?.id).toBe("barn_raising");
    expect(nextGoalDefinition(testWorldState({ goals: [activeGoal()] }), content)).toBeUndefined();
    expect(
      nextGoalDefinition(testWorldState({ goals: [activeGoal({ status: "succeeded" })] }), content)
        ?.id,
    ).toBe("harvest_festival");
  });

  it("applies a changed schedule only at the next goal", () => {
    const first = { ...goalDefinition, id: "harvest_festival", kind: "festival" as const };
    const replacement = {
      ...goalDefinition,
      id: "second_barn",
      kind: "collective_build" as const,
    };
    const before = testContent({ goals: [goalDefinition, first] });
    const after = testContent({ goals: [goalDefinition, replacement] });
    const state = testWorldState({ goals: [activeGoal()] });

    expect(nextGoalDefinition(state, after)).toBeUndefined();

    state.goals[0]!.status = "succeeded";
    expect(nextGoalDefinition(state, before)?.id).toBe("harvest_festival");
    expect(nextGoalDefinition(state, after)?.id).toBe("second_barn");
  });
});

describe("goal progress", () => {
  it("aggregates locked and consumed contributions per item", () => {
    const state = stateWithGoal({
      contributions: [
        {
          id: "c1",
          goalId: "barn_raising",
          playerId: "p1",
          orderId: "o1",
          items: [{ item: "grain", quantity: 3 }],
          status: "locked",
        },
        {
          id: "c2",
          goalId: "barn_raising",
          playerId: "p1",
          orderId: "o2",
          items: [
            { item: "grain", quantity: 1 },
            { item: "wood", quantity: 1 },
          ],
          status: "consumed",
        },
        {
          id: "c3",
          goalId: "barn_raising",
          playerId: "p1",
          orderId: "o3",
          items: [{ item: "grain", quantity: 9 }],
          status: "released",
        },
      ],
    });

    const progress = goalProgress(state, state.goals[0]!);

    expect(progress.entries).toEqual([
      { item: "grain", required: 5, contributed: 4, remaining: 1 },
      { item: "wood", required: 2, contributed: 1, remaining: 1 },
    ]);
    expect(progress.complete).toBe(false);
  });

  it("checks success before expiry", () => {
    const goal = activeGoal();
    const incomplete = { goalId: goal.id, entries: [], complete: false };
    const complete = { goalId: goal.id, entries: [], complete: true };

    expect(goalStatusAt(goal, incomplete, 7)).toBe("active");
    expect(goalStatusAt(goal, incomplete, 8)).toBe("expired");
    expect(goalStatusAt(goal, complete, 8)).toBe("succeeded");
  });
});

describe("contribute_goal orders", () => {
  it("locks contributed goods without consuming them", () => {
    const state = stateWithGoal();
    const order = contributeOrder({
      goalId: "barn_raising",
      items: [{ item: "grain", quantity: 3 }],
    });

    const result = runOrder(state, testContent(), order);

    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
    expect(state.inventory.find((row) => row.item === "grain")).toMatchObject({
      quantity: 10,
      locked: 3,
    });
    expect(state.contributions).toEqual([
      {
        id: "contribution:goal-order-1",
        goalId: "barn_raising",
        playerId: "p1",
        orderId: "goal-order-1",
        items: [{ item: "grain", quantity: 3 }],
        status: "locked",
      },
    ]);
    expect(result.events.events.map((event) => event.type)).toEqual([
      "goal_contribution",
      "goal_progress",
    ]);
  });

  it("rejects over-contribution and unknown goods without changing state", () => {
    const state = stateWithGoal();
    const over = runOrder(
      state,
      testContent(),
      contributeOrder({
        goalId: "barn_raising",
        items: [{ item: "grain", quantity: 6 }],
      }),
    );
    const unknown = runOrder(
      state,
      testContent(),
      contributeOrder({
        goalId: "barn_raising",
        items: [{ item: "stone", quantity: 1 }],
      }),
    );

    expect(over.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    expect(state.inventory.find((row) => row.item === "grain")?.locked).toBe(0);
    expect(state.contributions).toEqual([]);
  });

  it("rejects a goal at its deadline", () => {
    const state = stateWithGoal({ goals: [activeGoal({ deadlineTick: 5 })] });

    const result = runOrder(
      state,
      testContent(),
      contributeOrder({
        goalId: "barn_raising",
        items: [{ item: "grain", quantity: 1 }],
      }),
    );

    expect(result.ok).toBe(false);
    expect(state.contributions).toEqual([]);
  });
});

describe("goal outcomes", () => {
  function stateWithContribution(status: "locked" | "consumed" = "locked"): WorldState {
    return stateWithGoal({
      inventory: [
        { plotId: "plot1", item: "grain", quantity: 5, locked: 5 },
        { plotId: "plot1", item: "wood", quantity: 0, locked: 0 },
      ],
      contributions: [
        {
          id: "c1",
          goalId: "barn_raising",
          playerId: "p1",
          orderId: "o1",
          items: [{ item: "grain", quantity: 5 }],
          status,
        },
      ],
    });
  }

  it("consumes locked goods on success", () => {
    const state = stateWithContribution();
    const events = new EventLog(5);

    succeedGoal(state, state.goals[0]!, events);

    expect(state.inventory.find((row) => row.item === "grain")).toBeUndefined();
    expect(state.contributions[0]?.status).toBe("consumed");
    expect(state.goals[0]?.status).toBe("succeeded");
    expect(events.events.map((event) => event.type)).toEqual(["goal_completed"]);
  });

  it("releases locks when a goal expires", () => {
    const state = stateWithContribution();

    expireGoal(state, state.goals[0]!);

    expect(state.inventory.find((row) => row.item === "grain")).toMatchObject({
      quantity: 5,
      locked: 0,
    });
    expect(state.contributions[0]?.status).toBe("released");
    expect(state.goals[0]?.status).toBe("expired");
  });
});

describe("goal contribution locking", () => {
  it("locks at queue time and releases on cancel or removal", () => {
    const state = stateWithGoal();
    const input = {
      id: "queued-goal",
      playerId: "p1",
      tick: 5,
      type: "contribute_goal" as const,
      payload: { goalId: "barn_raising", items: [{ item: "grain", quantity: 3 }] },
    };

    expect(queueOrder(state, testContent(), input).ok).toBe(true);
    expect(state.inventory.find((row) => row.item === "grain")?.locked).toBe(3);
    expect(cancelOrder(state, "queued-goal")).toBe(true);
    expect(state.inventory.find((row) => row.item === "grain")?.locked).toBe(0);

    expect(queueOrder(state, testContent(), { ...input, id: "removed-goal" }).ok).toBe(true);
    expect(removeOrder(state, "removed-goal")).not.toBeNull();
    expect(state.inventory.find((row) => row.item === "grain")?.locked).toBe(0);
  });

  it("consumes queued goods only when the goal succeeds", () => {
    const state = stateWithGoal();
    const input = {
      id: "queued-goal",
      playerId: "p1",
      tick: 5,
      type: "contribute_goal" as const,
      payload: { goalId: "barn_raising", items: [{ item: "grain", quantity: 5 }] },
    };
    expect(queueOrder(state, testContent(), input).ok).toBe(true);
    const order = state.orders[0]!;
    const events = new EventLog(5);
    const locked = preLockedItems(state, order.id);
    expect(locked).toEqual([{ item: "grain", quantity: 5 }]);

    const outcome = resolveOrder({
      state,
      content: testContent(),
      order,
      player: state.players[0]!,
      location: { regionId: "r1" },
      reachable: new Set(["r1"]),
      path: [],
      events,
      ...(locked ? { preLockedItems: locked } : {}),
    });
    expect(outcome.ok).toBe(true);
    expect(state.inventory.find((row) => row.item === "grain")).toMatchObject({
      quantity: 10,
      locked: 5,
    });

    succeedGoal(state, state.goals[0]!, events);
    expect(state.inventory.find((row) => row.item === "grain")).toMatchObject({
      quantity: 5,
      locked: 0,
    });
    expect(state.contributions[0]?.status).toBe("consumed");
  });
});

describe("goal phase", () => {
  it("resolves success before expiry at the deadline", () => {
    const state = stateWithGoal({
      goals: [activeGoal({ deadlineTick: 5 })],
      inventory: [
        { plotId: "plot1", item: "grain", quantity: 5, locked: 5 },
        { plotId: "plot1", item: "wood", quantity: 2, locked: 2 },
      ],
      contributions: [
        {
          id: "c1",
          goalId: "barn_raising",
          playerId: "p1",
          orderId: "o1",
          items: [
            { item: "grain", quantity: 5 },
            { item: "wood", quantity: 2 },
          ],
          status: "locked",
        },
      ],
    });

    const result = runTick(state);

    expect(result.state.goals[0]?.status).toBe("succeeded");
    expect(result.state.contributions[0]?.status).toBe("consumed");
    expect(result.state.inventory).toEqual([]);
    expect(result.state.unlockedBuildings).toContain("barn");
    const types = result.events.map((event) => event.type);
    expect(types.at(-2)).toBe("goal_progress");
    expect(types.at(-1)).toBe("goal_completed");
  });

  it("expires an incomplete goal and releases its locks", () => {
    const state = stateWithGoal({
      goals: [activeGoal({ deadlineTick: 5 })],
      inventory: [{ plotId: "plot1", item: "grain", quantity: 3, locked: 3 }],
      contributions: [
        {
          id: "c1",
          goalId: "barn_raising",
          playerId: "p1",
          orderId: "o1",
          items: [{ item: "grain", quantity: 3 }],
          status: "locked",
        },
      ],
    });

    const result = runTick(state);

    expect(result.state.goals[0]?.status).toBe("expired");
    expect(result.state.contributions[0]?.status).toBe("released");
    expect(result.state.inventory.find((row) => row.item === "grain")).toMatchObject({
      quantity: 3,
      locked: 0,
    });
    const types = result.events.map((event) => event.type);
    expect(types).toContain("goal_progress");
    expect(types).not.toContain("goal_completed");
  });

  it("checks goals after this tick's contributions", () => {
    const state = stateWithGoal({
      goals: [activeGoal({ deadlineTick: 6, requires: [{ item: "grain", quantity: 2 }] })],
      inventory: [{ plotId: "plot1", item: "grain", quantity: 10, locked: 0 }],
    });
    const queued = queueOrder(state, testContent(), {
      id: "last-minute",
      playerId: "p1",
      tick: 5,
      type: "contribute_goal",
      payload: { goalId: "barn_raising", items: [{ item: "grain", quantity: 2 }] },
    });
    expect(queued.ok).toBe(true);

    const result = runTick(state);
    const types = result.events.map((event) => event.type);

    expect(result.state.goals[0]?.status).toBe("succeeded");
    expect(types.indexOf("order_resolved")).toBeLessThan(types.indexOf("goal_completed"));
  });
});

describe("goal rewards", () => {
  it("unlocks every reward kind for the whole world", () => {
    const goal = activeGoal({
      rewards: [
        { kind: "recipe", id: "feast" },
        { kind: "crop", id: "pumpkin" },
        { kind: "building", id: "barn" },
        { kind: "map_area", id: "r3" },
        { kind: "wild_zone", id: "n9" },
      ],
    });
    const state = stateWithGoal({ goals: [goal] });

    succeedGoal(state, state.goals[0]!);
    succeedGoal(state, state.goals[0]!);

    expect(state.unlockedRecipes).toEqual(["feast"]);
    expect(state.unlockedCrops).toEqual(["pumpkin"]);
    expect(state.unlockedBuildings).toEqual(["barn"]);
    expect(state.unlockedRegions).toEqual(["r3"]);
    expect(state.unlockedNodes).toEqual(["n9"]);
  });

  it("makes rewards available from the next tick", () => {
    const state = stateWithGoal({
      goals: [activeGoal({ deadlineTick: 6, requires: [] })],
    });

    const result = runTick(state);

    expect(result.state.goals[0]?.status).toBe("succeeded");
    expect(result.state.unlockedBuildings).toContain("barn");
  });
});

describe("recipe discovery", () => {
  it("unlocks a gated recipe from the next tick after a goal succeeds", () => {
    const secret: RecipeDefinition = {
      id: "secret",
      name: "Secret",
      building: "kitchen",
      buildingLevel: 1,
      inputs: [{ item: "grain", quantity: 1 }],
      outputs: [{ item: "berries", quantity: 1 }],
      durationTicks: 0,
      unlockedByDefault: false,
    };
    const state = stateWithGoal({
      goals: [
        activeGoal({
          requires: [],
          rewards: [{ kind: "recipe", id: "secret" }],
        }),
      ],
      buildings: [
        {
          id: "kitchen-1",
          plotId: "plot1",
          type: "kitchen",
          level: 1,
          constructionKind: null,
          constructionCompleteTick: null,
          craftQueue: [],
        },
      ],
    });
    const content = testContent({ recipes: [secret] });

    expect(isRecipeUnlocked(state, content, "secret", state.buildings[0]!)).toBe(false);

    const result = runTick(state, content);

    expect(result.state.unlockedRecipes).toContain("secret");
    expect(isRecipeUnlocked(result.state, content, "secret", result.state.buildings[0]!)).toBe(
      true,
    );
  });
});
