import { describe, expect, it } from "vitest";

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
import { resolveOrder, type OrderExecutionContext } from "../src/orders.js";
import type {
  ContentPack,
  ContributeGoalPayload,
  Goal,
  GoalDefinition,
  Order,
  WorldState,
} from "../src/types.js";
import { testContent, testOrder, testWorldState } from "./fixtures.js";

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
