/**
 * Unit tests for push subscription persistence (CT.05; M7.12).
 *
 * Covers CRUD operations for subscriptions and ensures that the DB layer
 * correctly stores, lists and deletes player subscriptions.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../../src/db/database.js";
import {
  listPushSubscriptions,
  subscribePush,
  unsubscribePush,
} from "../../src/db/pushRepository.js";

let db: Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe("push subscription repository", () => {
  beforeEach(() => {
    db = Database.open();
    db.exec(
      "INSERT INTO worlds (id, seed, generator_version, content_version, rules_version, deadline_time, timezone, min_tick_gap_minutes, player_cap, season, weather, current_tick) VALUES ('w1', 'seed', 'gen-1', 'content-1', 'rules-1', '20:00', 'UTC', 60, 20, 'spring', 'clear', 0)",
    );
    db.exec(
      "INSERT INTO players (id, name, plot_id, joined_tick, energy) VALUES ('p1', 'Test', 'plot1', 0, 100)",
    );
  });

  it("stores and retrieves a subscription for a player", () => {
    subscribePush(db!, "p1", "https://push.example/abc", "p256dh-key", "auth-key");
    const list = listPushSubscriptions(db!, "p1");
    expect(list).toEqual([
      { endpoint: "https://push.example/abc", p256dh: "p256dh-key", auth: "auth-key" },
    ]);
  });

  it("stores multiple subscriptions for the same player", () => {
    subscribePush(db!, "p1", "https://push.example/abc", "p256dh-key", "auth-key");
    subscribePush(db!, "p1", "https://push.example/def", "p256dh-key2", "auth-key2");
    const list = listPushSubscriptions(db!, "p1");
    expect(list).toEqual([
      { endpoint: "https://push.example/abc", p256dh: "p256dh-key", auth: "auth-key" },
      { endpoint: "https://push.example/def", p256dh: "p256dh-key2", auth: "auth-key2" },
    ]);
  });

  it("replaces a subscription at the same endpoint", () => {
    subscribePush(db!, "p1", "https://push.example/abc", "p256dh-key", "auth-key");
    subscribePush(db!, "p1", "https://push.example/abc", "p256dh-key2", "auth-key2");
    const list = listPushSubscriptions(db!, "p1");
    expect(list).toEqual([
      { endpoint: "https://push.example/abc", p256dh: "p256dh-key2", auth: "auth-key2" },
    ]);
  });

  it("does not return subscriptions for other players", () => {
    subscribePush(db!, "p1", "https://push.example/abc", "p256dh-key", "auth-key");
    const p2List = listPushSubscriptions(db!, "p2");
    expect(p2List).toEqual([]);
  });

  it("removes a subscription when asked", () => {
    subscribePush(db!, "p1", "https://push.example/abc", "p256dh-key", "auth-key");
    const removed = unsubscribePush(db!, "p1", "https://push.example/abc");
    expect(removed).toBe(true);
    const list = listPushSubscriptions(db!, "p1");
    expect(list).toEqual([]);
  });

  it("returns false when removing a non-existent subscription", () => {
    const removed = unsubscribePush(db!, "p1", "https://push.example/def");
    expect(removed).toBe(false);
  });
});
