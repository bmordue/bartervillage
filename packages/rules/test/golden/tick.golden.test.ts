import { describe, it } from "vitest";

import { testContent, testOrder, testPlayer, testWorldState } from "../fixtures.js";
import { expectGolden, runGoldenScenario } from "../support/golden.js";

describe("golden tick logs", () => {
  it("records an empty tick", () => {
    const state = testWorldState();
    expectGolden("empty-tick", runGoldenScenario(state, testContent()));
  });

  it("records a travel order", () => {
    const state = testWorldState({ orders: [testOrder()] });
    expectGolden("travel-tick", runGoldenScenario(state, testContent()));
  });

  it("records the documented player ordering", () => {
    const state = testWorldState({
      players: [testPlayer({ id: "p2" }), testPlayer({ id: "p1" })],
      orders: [
        testOrder({ id: "a", playerId: "p2", sequence: 1 }),
        testOrder({ id: "b", playerId: "p1", sequence: 1 }),
      ],
    });
    expectGolden("ordering-tick", runGoldenScenario(state, testContent()));
  });
});
