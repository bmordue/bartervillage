/**
 * Public trade history (M6.14; spec §7).
 */

import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import type { ArchivedEvent, JsonObject } from "@bartervillage/rules";
import { tradeHistoryFromEvents } from "../src/tradeHistory.js";
import { TradeHistoryPanel } from "../src/tradeHistoryPanel.js";

function event(
  sequence: number,
  type: ArchivedEvent["type"],
  payload: JsonObject,
  tick = 3,
): ArchivedEvent {
  return { tick, sequence, version: 1, type, payload };
}

const events: ArchivedEvent[] = [
  event(1, "weather", { weather: "sun" }),
  event(2, "post_created", {
    offerId: "offer-1",
    posterId: "p1",
    kind: "offer",
    expiryTick: 4,
    parentOfferId: null,
  }),
  event(3, "trade_completed", {
    offerId: "offer-1",
    parentOfferId: null,
    buyerId: "p2",
    sellerId: "p1",
    gives: [{ item: "wheat", quantity: 2 }],
    wants: [{ item: "carrot", quantity: 1 }],
  }),
  event(4, "post_cancelled", { offerId: "offer-2", reason: "settled" }),
  event(5, "post_expired", { offerId: "offer-3" }),
  event(6, "season_change", { season: "summer" }),
];

describe("trade history (M6.14)", () => {
  it("projects only public trade events in sequence order", () => {
    const history = tradeHistoryFromEvents(events);
    expect(history.map((entry) => entry.sequence)).toEqual([2, 3, 4, 5]);
    expect(history.map((entry) => entry.type)).toEqual(["post", "trade", "cancel", "expire"]);
    expect(history[0]?.summary).toBe("p1 posted Offer (offer-1)");
    expect(history[1]?.summary).toBe("p2 bought 2 Wheat from p1 for 1 Carrot");
  });

  it("renders an empty state before any trades settle", () => {
    expect(render(TradeHistoryPanel({ events: [] }))).toContain(
      "No trades yet. Settled offers appear here.",
    );
  });

  it("renders settled trades and posts with tick labels", () => {
    const html = render(TradeHistoryPanel({ events }));
    expect(html).toContain("Trade history");
    expect(html).toContain("T3");
    expect(html).toContain("p2 bought 2 Wheat from p1 for 1 Carrot");
    expect(html).toContain("Offer offer-2 settled");
  });
});
