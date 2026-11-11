import { describe, expect, it } from "vitest";

import {
  expirePosts,
  openPostCount,
  registerBarterHandlers,
  validateOfferExpiry,
} from "../src/barter.js";
import { EventLog } from "../src/events.js";
import { addItems } from "../src/inventory.js";
import { resolveOrder, type OrderExecutionContext, type OrderOutcome } from "../src/orders.js";
import type { ContentPack, Offer, Order, WorldState } from "../src/types.js";
import { freeQuantity, heldQuantity, lockedQuantity } from "../src/world.js";
import { makeOrder, scenario, testContent } from "./support/harness.js";

registerBarterHandlers();

function content(storageCapacity = 100): ContentPack {
  return testContent({
    buildings: [
      {
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
            storageCapacity,
            unlocksRecipes: [],
          },
        ],
      },
    ],
  });
}

function makeState(playerCount = 2): WorldState {
  const state = scenario({ players: playerCount });
  state.buildings = state.plots.map((plot, index) => ({
    id: `b${index + 1}`,
    plotId: plot.id,
    type: "storehouse",
    level: 1,
    constructionKind: null,
    constructionCompleteTick: null,
    craftQueue: [],
  }));
  return state;
}

function run(
  state: WorldState,
  contentPack: ContentPack,
  order: Order,
  events = new EventLog(state.world.currentTick),
): { outcome: OrderOutcome; events: EventLog } {
  const player = state.players.find((candidate) => candidate.id === order.playerId);
  if (!player) {
    throw new Error(`Missing player ${order.playerId}`);
  }
  const context: OrderExecutionContext & { events: EventLog } = {
    state,
    content: contentPack,
    order,
    player,
    location: { regionId: "r1" },
    reachable: new Set(["r1"]),
    path: [],
    events,
  };
  return { outcome: resolveOrder(context), events };
}

function offerEventTypes(events: EventLog): string[] {
  return events.events.map((event) => event.type);
}

describe("barter board", () => {
  it("posting an offer locks the offered goods and emits post_created", () => {
    const state = makeState();
    const pack = content();
    addItems(state, pack, "plot1", [{ item: "grain", quantity: 5 }]);
    const events = new EventLog(5);

    const order = makeOrder("post_offer", {
      gives: [{ item: "grain", quantity: 3 }],
      wants: [{ item: "wood", quantity: 2 }],
      expiryTicks: 7,
    });
    const { outcome } = run(state, pack, order, events);

    expect(outcome.ok).toBe(true);
    expect(freeQuantity(state, "plot1", "grain")).toBe(2);
    expect(lockedQuantity(state, "plot1", "grain")).toBe(3);
    expect(state.offers).toHaveLength(1);
    expect(state.offers[0]).toMatchObject({
      id: "offer:o1",
      posterId: "p1",
      kind: "offer",
      quantity: 1,
      createdAtTick: 5,
      expiryTick: 12,
      status: "open",
      parentOfferId: null,
    });
    expect(offerEventTypes(events)).toEqual(["post_created"]);
    expect(events.events[0]?.payload).toMatchObject({
      offerId: "offer:o1",
      posterId: "p1",
      kind: "offer",
      expiryTick: 12,
      parentOfferId: null,
    });
  });

  it("a wanted request locks nothing and cannot be accepted directly", () => {
    const state = makeState();
    const pack = content();
    const events = new EventLog(5);

    const order = makeOrder("post_wanted_request", {
      wants: [{ item: "grain", quantity: 4 }],
      quantity: 2,
      expiryTicks: 7,
    });
    const { outcome } = run(state, pack, order, events);

    expect(outcome.ok).toBe(true);
    expect(state.inventory).toEqual([]);
    expect(state.offers[0]).toMatchObject({
      kind: "wanted_request",
      gives: [],
      wants: [{ item: "grain", quantity: 4 }],
      quantity: 2,
      createdAtTick: 5,
      expiryTick: 12,
      parentOfferId: null,
    });

    state.world.currentTick = 6;
    const accept = makeOrder(
      "accept_offer",
      { offerId: state.offers[0]!.id },
      { id: "o2", playerId: "p2", tick: 6, sequence: 2 },
    );
    const accepted = run(state, pack, accept, new EventLog(6));
    expect(accepted.outcome.ok).toBe(false);
    expect(accepted.outcome.reason).toContain("wanted request");
    expect(state.offers[0]?.status).toBe("open");
  });

  it("counters are one level deep, cannot target your own post and lock only the counterer's goods", () => {
    const state = makeState(3);
    const pack = content();
    addItems(state, pack, "plot1", [{ item: "grain", quantity: 5 }]);
    addItems(state, pack, "plot2", [{ item: "wood", quantity: 5 }]);
    addItems(state, pack, "plot3", [{ item: "stone", quantity: 5 }]);
    const events = new EventLog(5);

    const parentOrder = makeOrder("post_offer", {
      gives: [{ item: "grain", quantity: 3 }],
      wants: [{ item: "wood", quantity: 2 }],
      expiryTicks: 7,
    });
    expect(run(state, pack, parentOrder, events).outcome.ok).toBe(true);
    const parent = state.offers[0]!;

    const counterOrder = makeOrder(
      "counter_offer",
      {
        parentOfferId: parent.id,
        gives: [{ item: "wood", quantity: 1 }],
        wants: [{ item: "grain", quantity: 2 }],
      },
      { id: "o2", playerId: "p2", sequence: 2 },
    );
    expect(run(state, pack, counterOrder, events).outcome.ok).toBe(true);
    const counter = state.offers[1]!;

    expect(counter).toMatchObject({
      kind: "counter_offer",
      parentOfferId: parent.id,
      expiryTick: parent.expiryTick,
      posterId: "p2",
    });
    expect(parent.status).toBe("open");
    expect(lockedQuantity(state, "plot1", "grain")).toBe(3);
    expect(lockedQuantity(state, "plot2", "wood")).toBe(1);
    expect(freeQuantity(state, "plot2", "wood")).toBe(4);

    const selfCounter = makeOrder(
      "counter_offer",
      {
        parentOfferId: parent.id,
        gives: [{ item: "grain", quantity: 1 }],
        wants: [{ item: "wood", quantity: 1 }],
      },
      { id: "o3", playerId: "p1", sequence: 3 },
    );
    const selfResult = run(state, pack, selfCounter, events);
    expect(selfResult.outcome.ok).toBe(false);
    expect(selfResult.outcome.reason).toContain("own");

    const nestedCounter = makeOrder(
      "counter_offer",
      {
        parentOfferId: counter.id,
        gives: [{ item: "grain", quantity: 1 }],
        wants: [{ item: "wood", quantity: 1 }],
      },
      { id: "o4", playerId: "p1", sequence: 4 },
    );
    const nestedResult = run(state, pack, nestedCounter, events);
    expect(nestedResult.outcome.ok).toBe(false);
    expect(nestedResult.outcome.reason).toContain("countered");
    expect(state.offers).toHaveLength(2);
  });

  it("validates expiry bounds and rejects out-of-range posts without taking locks", () => {
    for (const value of [1, 7, 28]) {
      expect(validateOfferExpiry(value)).toBe(true);
    }
    for (const value of [0, 29, -1, 1.5, Number.NaN]) {
      expect(validateOfferExpiry(value)).toBe(false);
    }

    const state = makeState();
    const pack = content();
    addItems(state, pack, "plot1", [{ item: "grain", quantity: 5 }]);

    for (const [index, expiryTicks] of [0, 29].entries()) {
      const order = makeOrder(
        "post_offer",
        {
          gives: [{ item: "grain", quantity: 1 }],
          wants: [{ item: "wood", quantity: 1 }],
          expiryTicks,
        },
        { id: `bad${index}` },
      );
      const { outcome } = run(state, pack, order);
      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toContain("Expiry");
    }
    expect(lockedQuantity(state, "plot1", "grain")).toBe(0);
    expect(state.offers).toEqual([]);
  });

  it("cannot accept your own post", () => {
    const state = makeState();
    const pack = content();
    addItems(state, pack, "plot1", [
      { item: "grain", quantity: 5 },
      { item: "wood", quantity: 5 },
    ]);

    const post = makeOrder("post_offer", {
      gives: [{ item: "grain", quantity: 3 }],
      wants: [{ item: "wood", quantity: 2 }],
      expiryTicks: 7,
    });
    expect(run(state, pack, post).outcome.ok).toBe(true);
    state.world.currentTick = 6;

    const accept = makeOrder("accept_offer", { offerId: state.offers[0]!.id }, { id: "o2" });
    const result = run(state, pack, accept);
    expect(result.outcome.ok).toBe(false);
    expect(result.outcome.reason).toContain("own");
    expect(state.offers[0]?.status).toBe("open");
    expect(lockedQuantity(state, "plot1", "grain")).toBe(3);
  });

  it("rejects acceptance before the next tick and after expiry", () => {
    const state = makeState();
    const pack = content();
    addItems(state, pack, "plot1", [{ item: "grain", quantity: 5 }]);
    addItems(state, pack, "plot2", [{ item: "wood", quantity: 4 }]);

    const post = makeOrder("post_offer", {
      gives: [{ item: "grain", quantity: 3 }],
      wants: [{ item: "wood", quantity: 2 }],
      expiryTicks: 7,
    });
    expect(run(state, pack, post).outcome.ok).toBe(true);
    const offerId = state.offers[0]!.id;
    expect(state.offers[0]?.expiryTick).toBe(12);

    const tooSoon = makeOrder(
      "accept_offer",
      { offerId },
      { id: "o2", playerId: "p2", tick: 5, sequence: 2 },
    );
    expect(run(state, pack, tooSoon).outcome.reason).toContain("not acceptable");

    state.world.currentTick = 13;
    const tooLate = makeOrder(
      "accept_offer",
      { offerId },
      { id: "o3", playerId: "p2", tick: 13, sequence: 3 },
    );
    expect(run(state, pack, tooLate).outcome.reason).toContain("not acceptable");

    expect(state.offers[0]?.status).toBe("open");
    expect(state.offers[0]?.kind).toBe("offer");
    expect(lockedQuantity(state, "plot1", "grain")).toBe(3);
    expect(state.offers).toHaveLength(1);
  });

  it("swaps goods on a successful direct acceptance", () => {
    const state = makeState();
    const pack = content();
    addItems(state, pack, "plot1", [{ item: "grain", quantity: 5 }]);
    addItems(state, pack, "plot2", [{ item: "wood", quantity: 4 }]);

    const post = makeOrder("post_offer", {
      gives: [{ item: "grain", quantity: 3 }],
      wants: [{ item: "wood", quantity: 2 }],
      expiryTicks: 7,
    });
    expect(run(state, pack, post).outcome.ok).toBe(true);
    state.world.currentTick = 6;

    const events = new EventLog(6);
    const accept = makeOrder(
      "accept_offer",
      { offerId: state.offers[0]!.id },
      { id: "o2", playerId: "p2", tick: 6, sequence: 2 },
    );
    const { outcome } = run(state, pack, accept, events);

    expect(outcome.ok).toBe(true);
    expect(heldQuantity(state, "plot1", "grain")).toBe(2);
    expect(heldQuantity(state, "plot1", "wood")).toBe(2);
    expect(heldQuantity(state, "plot2", "wood")).toBe(2);
    expect(heldQuantity(state, "plot2", "grain")).toBe(3);
    expect(lockedQuantity(state, "plot1", "grain")).toBe(0);
    expect(lockedQuantity(state, "plot2", "wood")).toBe(0);
    expect(state.offers[0]?.status).toBe("settled");

    const trade = events.events.find((event) => event.type === "trade_completed");
    expect(trade?.payload).toMatchObject({
      offerId: "offer:o1",
      parentOfferId: null,
      buyerId: "p2",
      sellerId: "p1",
      gives: [{ item: "grain", quantity: 3 }],
      wants: [{ item: "wood", quantity: 2 }],
    });
  });

  it("fails an acceptance without capacity and keeps the parent open with its locks", () => {
    const state = makeState();
    const pack = content(5);
    addItems(state, pack, "plot1", [{ item: "grain", quantity: 3 }]);
    addItems(state, pack, "plot2", [{ item: "wood", quantity: 5 }]);

    const post = makeOrder("post_offer", {
      gives: [{ item: "grain", quantity: 3 }],
      wants: [{ item: "wood", quantity: 2 }],
      expiryTicks: 7,
    });
    expect(run(state, pack, post).outcome.ok).toBe(true);
    state.world.currentTick = 6;

    const events = new EventLog(6);
    const accept = makeOrder(
      "accept_offer",
      { offerId: state.offers[0]!.id },
      { id: "o2", playerId: "p2", tick: 6, sequence: 2 },
    );
    const { outcome } = run(state, pack, accept, events);

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("capacity");
    expect(state.offers[0]?.status).toBe("open");
    expect(lockedQuantity(state, "plot1", "grain")).toBe(3);
    expect(heldQuantity(state, "plot1", "grain")).toBe(3);
    expect(lockedQuantity(state, "plot2", "wood")).toBe(0);
    expect(heldQuantity(state, "plot2", "wood")).toBe(5);
    expect(offerEventTypes(events)).not.toContain("trade_completed");
  });

  it("cancelling a parent cascades to its counters and releases every lock", () => {
    const state = makeState(3);
    const pack = content();
    addItems(state, pack, "plot1", [{ item: "grain", quantity: 5 }]);
    addItems(state, pack, "plot2", [{ item: "wood", quantity: 5 }]);
    addItems(state, pack, "plot3", [{ item: "wood", quantity: 5 }]);

    const post = makeOrder("post_offer", {
      gives: [{ item: "grain", quantity: 2 }],
      wants: [{ item: "wood", quantity: 1 }],
      expiryTicks: 7,
    });
    expect(run(state, pack, post).outcome.ok).toBe(true);
    const parent = state.offers[0]!;

    for (const [index, playerId, plotId] of [
      [2, "p2", "plot2"],
      [3, "p3", "plot3"],
    ] as const) {
      const counter = makeOrder(
        "counter_offer",
        {
          parentOfferId: parent.id,
          gives: [{ item: "wood", quantity: 1 }],
          wants: [{ item: "grain", quantity: 1 }],
        },
        { id: `o${index}`, playerId, sequence: index },
      );
      expect(run(state, pack, counter).outcome.ok).toBe(true);
      expect(lockedQuantity(state, plotId, "wood")).toBe(1);
    }

    const events = new EventLog(5);
    const cancel = makeOrder("cancel_offer", { offerId: parent.id }, { id: "o4", sequence: 4 });
    const { outcome } = run(state, pack, cancel, events);

    expect(outcome.ok).toBe(true);
    expect(parent.status).toBe("cancelled");
    const counters = state.offers.filter((offer) => offer.kind === "counter_offer");
    expect(counters.every((counter) => counter.status === "cancelled")).toBe(true);
    expect(lockedQuantity(state, "plot1", "grain")).toBe(0);
    expect(lockedQuantity(state, "plot2", "wood")).toBe(0);
    expect(lockedQuantity(state, "plot3", "wood")).toBe(0);
    expect(openPostCount(state, "p1")).toBe(0);

    const cancellations = events.events.filter((event) => event.type === "post_cancelled");
    expect(cancellations.map((event) => event.payload)).toEqual([
      { offerId: parent.id, reason: "cancelled" },
      { offerId: "offer:o2", reason: "cascade" },
      { offerId: "offer:o3", reason: "cascade" },
    ]);
  });

  it("expires a parent at the start of expiryTick + 1 and cascades to counters", () => {
    const state = makeState(2);
    const pack = content();
    addItems(state, pack, "plot1", [{ item: "grain", quantity: 5 }]);
    addItems(state, pack, "plot2", [{ item: "wood", quantity: 5 }]);

    const post = makeOrder("post_offer", {
      gives: [{ item: "grain", quantity: 2 }],
      wants: [{ item: "wood", quantity: 1 }],
      expiryTicks: 3,
    });
    expect(run(state, pack, post).outcome.ok).toBe(true);
    const parent = state.offers[0]!;
    expect(parent.expiryTick).toBe(8);

    const counter = makeOrder(
      "counter_offer",
      {
        parentOfferId: parent.id,
        gives: [{ item: "wood", quantity: 1 }],
        wants: [{ item: "grain", quantity: 1 }],
      },
      { id: "o2", playerId: "p2", sequence: 2 },
    );
    expect(run(state, pack, counter).outcome.ok).toBe(true);
    const child = state.offers[1]!;

    state.world.currentTick = 8;
    const stillOpen = new EventLog(8);
    expirePosts(state, stillOpen);
    expect(parent.status).toBe("open");
    expect(stillOpen.events).toEqual([]);

    state.world.currentTick = 9;
    const events = new EventLog(9);
    expirePosts(state, events);

    expect(parent.status).toBe("expired");
    expect(child.status).toBe("cancelled");
    expect(lockedQuantity(state, "plot1", "grain")).toBe(0);
    expect(lockedQuantity(state, "plot2", "wood")).toBe(0);
    expect(offerEventTypes(events)).toEqual(["post_expired", "post_cancelled"]);
    expect(events.events[0]?.payload).toEqual({ offerId: parent.id });
    expect(events.events[1]?.payload).toEqual({ offerId: child.id, reason: "cascade" });
  });

  it("enforces the cap of ten open posts per player", () => {
    const state = makeState();
    const pack = content();
    addItems(state, pack, "plot1", [{ item: "grain", quantity: 1 }]);

    const kinds = ["offer", "wanted_request", "counter_offer"] as const;
    const offers: Offer[] = Array.from({ length: 10 }, (_, index) => ({
      id: `existing:${index}`,
      posterId: "p1",
      kind: kinds[index % kinds.length]!,
      gives: [],
      wants: [],
      quantity: 1,
      createdAtTick: 5,
      expiryTick: 12,
      status: "open",
      parentOfferId: null,
    }));
    offers.push({
      id: "closed",
      posterId: "p1",
      kind: "offer",
      gives: [],
      wants: [],
      quantity: 1,
      createdAtTick: 5,
      expiryTick: 12,
      status: "cancelled",
      parentOfferId: null,
    });
    state.offers = offers;

    expect(openPostCount(state, "p1")).toBe(10);
    const post = makeOrder("post_offer", {
      gives: [{ item: "grain", quantity: 1 }],
      wants: [{ item: "wood", quantity: 1 }],
      expiryTicks: 7,
    });
    const { outcome } = run(state, pack, post);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("10");
    expect(lockedQuantity(state, "plot1", "grain")).toBe(0);
    expect(state.offers).toHaveLength(11);
  });

  it("settles an accepted counter and cancels the parent and siblings", () => {
    const state = makeState(3);
    const pack = content();
    addItems(state, pack, "plot1", [{ item: "grain", quantity: 6 }]);
    addItems(state, pack, "plot2", [{ item: "wood", quantity: 3 }]);
    addItems(state, pack, "plot3", [{ item: "wood", quantity: 3 }]);

    const post = makeOrder("post_offer", {
      gives: [{ item: "grain", quantity: 3 }],
      wants: [{ item: "wood", quantity: 2 }],
      expiryTicks: 7,
    });
    expect(run(state, pack, post).outcome.ok).toBe(true);
    const parent = state.offers[0]!;

    const counter2 = makeOrder(
      "counter_offer",
      {
        parentOfferId: parent.id,
        gives: [{ item: "wood", quantity: 2 }],
        wants: [{ item: "grain", quantity: 3 }],
      },
      { id: "o2", playerId: "p2", sequence: 2 },
    );
    expect(run(state, pack, counter2).outcome.ok).toBe(true);
    const acceptedCounter = state.offers[1]!;

    const counter3 = makeOrder(
      "counter_offer",
      {
        parentOfferId: parent.id,
        gives: [{ item: "wood", quantity: 1 }],
        wants: [{ item: "grain", quantity: 2 }],
      },
      { id: "o3", playerId: "p3", sequence: 3 },
    );
    expect(run(state, pack, counter3).outcome.ok).toBe(true);
    const sibling = state.offers[2]!;

    expect(lockedQuantity(state, "plot1", "grain")).toBe(3);
    state.world.currentTick = 6;
    const events = new EventLog(6);
    const accept = makeOrder(
      "accept_offer",
      { offerId: acceptedCounter.id },
      { id: "o4", playerId: "p1", tick: 6, sequence: 4 },
    );
    const { outcome } = run(state, pack, accept, events);

    expect(outcome.ok).toBe(true);
    expect(acceptedCounter.status).toBe("settled");
    expect(parent.status).toBe("cancelled");
    expect(sibling.status).toBe("cancelled");
    expect(lockedQuantity(state, "plot1", "grain")).toBe(0);
    expect(lockedQuantity(state, "plot2", "wood")).toBe(0);
    expect(lockedQuantity(state, "plot3", "wood")).toBe(0);
    expect(heldQuantity(state, "plot1", "grain")).toBe(3);
    expect(heldQuantity(state, "plot1", "wood")).toBe(2);
    expect(heldQuantity(state, "plot2", "wood")).toBe(1);
    expect(heldQuantity(state, "plot2", "grain")).toBe(3);

    const trade = events.events.find((event) => event.type === "trade_completed");
    expect(trade?.payload).toMatchObject({
      offerId: acceptedCounter.id,
      parentOfferId: parent.id,
      buyerId: "p1",
      sellerId: "p2",
      gives: [{ item: "wood", quantity: 2 }],
      wants: [{ item: "grain", quantity: 3 }],
    });
    const cancellations = events.events.filter((event) => event.type === "post_cancelled");
    expect(cancellations.map((event) => event.payload)).toEqual([
      { offerId: parent.id, reason: "settled" },
      { offerId: sibling.id, reason: "cascade" },
    ]);

    const lateAccept = makeOrder(
      "accept_offer",
      { offerId: sibling.id },
      { id: "o5", playerId: "p1", tick: 6, sequence: 5 },
    );
    const lateResult = run(state, pack, lateAccept, new EventLog(6));
    expect(lateResult.outcome.ok).toBe(false);
    expect(lateResult.outcome.reason).toContain("not open");
  });
});
