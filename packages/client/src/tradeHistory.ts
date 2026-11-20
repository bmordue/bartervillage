/**
 * Public trade history derived from archived events (M6.14; spec §7).
 *
 * Replay payloads are public game events, so the same projection powers both
 * the live event log and replay playback without exposing private data.
 */

import type { ArchivedEvent, ItemStack } from "@bartervillage/rules";

export interface TradeHistoryEntry {
  sequence: number;
  tick: number;
  type: "trade" | "post" | "cancel" | "expire";
  summary: string;
}

function humanize(value: string): string {
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function describeStacks(stacks: ItemStack[]): string {
  if (stacks.length === 0) {
    return "nothing";
  }
  return stacks.map((stack) => `${stack.quantity} ${humanize(stack.item)}`).join(", ");
}

function asStacks(value: unknown): ItemStack[] {
  return Array.isArray(value) ? (value as ItemStack[]) : [];
}

function summarize(event: ArchivedEvent): TradeHistoryEntry | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case "trade_completed":
      return {
        sequence: event.sequence,
        tick: event.tick,
        type: "trade",
        summary: `${String(payload.buyerId)} bought ${describeStacks(asStacks(payload.gives))} from ${String(payload.sellerId)} for ${describeStacks(asStacks(payload.wants))}`,
      };
    case "post_created":
      return {
        sequence: event.sequence,
        tick: event.tick,
        type: "post",
        summary: `${String(payload.posterId)} posted ${humanize(String(payload.kind))} (${String(payload.offerId)})`,
      };
    case "post_cancelled":
      return {
        sequence: event.sequence,
        tick: event.tick,
        type: "cancel",
        summary: `Offer ${String(payload.offerId)} ${String(payload.reason)}`,
      };
    case "post_expired":
      return {
        sequence: event.sequence,
        tick: event.tick,
        type: "expire",
        summary: `Offer ${String(payload.offerId)} expired`,
      };
    default:
      return null;
  }
}

/** Project archived events into an ordered public trade history. */
export function tradeHistoryFromEvents(events: readonly ArchivedEvent[]): TradeHistoryEntry[] {
  return events
    .map((event) => summarize(event))
    .filter((entry): entry is TradeHistoryEntry => entry !== null);
}
