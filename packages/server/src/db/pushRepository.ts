/**
 * Push subscription persistence (spec §11, §12; M7.12).
 *
 * Stores browser push subscriptions (endpoint + p256dh + auth keys) per player
 * so the worker can notify players when a tick resolves.
 */

import type { Database } from "./database.js";

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

type PushSubscriptionRow = {
  id: string;
  player_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
};

function toPushSubscription(row: PushSubscriptionRow): PushSubscription {
  return {
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
  };
}

/** Subscribe a player to push notifications (or replace an existing one). */
export function subscribePush(
  db: Database,
  playerId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
): void {
  db.run(
    `INSERT OR REPLACE INTO push_subscriptions (id, player_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    `push:${playerId}:${sanitizeId(endpoint)}`,
    playerId,
    endpoint,
    p256dh,
    auth,
    new Date().toISOString(),
  );
}

/** Remove one subscription for a player. Returns true when a row was removed. */
export function unsubscribePush(db: Database, playerId: string, endpoint: string): boolean {
  const result = db.run(
    "DELETE FROM push_subscriptions WHERE player_id = ? AND endpoint = ?",
    playerId,
    endpoint,
  );
  return Number(result.changes) === 1;
}

/** Return every subscription stored for a player. */
export function listPushSubscriptions(db: Database, playerId: string): PushSubscription[] {
  const rows = db.all<PushSubscriptionRow>(
    "SELECT * FROM push_subscriptions WHERE player_id = ? ORDER BY created_at",
    playerId,
  );
  return rows.map(toPushSubscription);
}

/** Remove every subscription for a player. Returns the number removed. */
export function clearPushSubscriptions(db: Database, playerId: string): number {
  const result = db.run("DELETE FROM push_subscriptions WHERE player_id = ?", playerId);
  return Number(result.changes);
}

/** Safe subscription endpoint -> id segment (rejects nothing, just escapes). */
function sanitizeId(endpoint: string): string {
  return endpoint.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
