/**
 * Barter board fetch and post flows (M5.A03, M6.02).
 *
 * Wraps `GET /barter` so the barter panel can list open offers, wanted requests
 * and counter-offers, and builds the order drafts for creating offers and
 * wanted requests with explicit expiry and lock behaviour.
 */

import { MAX_OFFER_EXPIRY_TICKS, MIN_OFFER_EXPIRY_TICKS } from "@bartervillage/rules";

import type { OrderDraft } from "./orders.js";

export interface ItemStack {
  item: string;
  quantity: number;
}

export interface ItemStock {
  item: string;
  free: number;
}

export interface BarterOffer {
  id: string;
  posterId: string;
  posterName?: string;
  kind: string;
  gives: ItemStack[];
  wants: ItemStack[];
  quantity: number;
  createdAtTick: number;
  expiryTick: number;
  status: string;
  parentOfferId: string | null;
  posterFreeStock?: ItemStock[];
}

interface BarterResponse {
  offers?: BarterOffer[];
}

/** Fetch the open posts on the barter board. Throws on a non-2xx response. */
export async function fetchBarter(
  baseUrl = "",
  worldId = "w1",
  signal?: AbortSignal,
): Promise<BarterOffer[]> {
  const response = await fetch(`${baseUrl}/barter`, {
    headers: { "x-world-id": worldId },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`GET /barter failed with ${response.status}`);
  }
  const body = (await response.json()) as BarterResponse;
  return body.offers ?? [];
}

export type BarterPostKind = "offer" | "wanted_request" | "counter_offer";

export interface OfferDraft {
  gives: ItemStack[];
  wants: ItemStack[];
  expiryTicks: number;
}

export interface WantedRequestDraft {
  wants: ItemStack[];
  quantity: number;
  expiryTicks: number;
}

export const DEFAULT_EXPIRY_TICKS = 7;

/**
 * Build a single stack from form input. Light, non-authoritative validation:
 * the server still checks ownership, free stock and content ids.
 */
export function createStack(item: string, quantity: number): ItemStack {
  const trimmed = item.trim();
  if (trimmed.length === 0) {
    throw new Error("Choose an item.");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }
  return { item: trimmed, quantity };
}

function positiveStacks(stacks: readonly ItemStack[], label: string): ItemStack[] {
  if (stacks.length === 0) {
    throw new Error(`${label} must include at least one item.`);
  }
  return stacks.map((stack) => createStack(stack.item, stack.quantity));
}

/** Expiry is configurable from 1 to 28 ticks (spec §7). */
export function validatePostExpiry(expiryTicks: number): void {
  if (
    !Number.isInteger(expiryTicks) ||
    expiryTicks < MIN_OFFER_EXPIRY_TICKS ||
    expiryTicks > MAX_OFFER_EXPIRY_TICKS
  ) {
    throw new Error(
      `Expiry must be a whole number from ${MIN_OFFER_EXPIRY_TICKS} to ${MAX_OFFER_EXPIRY_TICKS} ticks.`,
    );
  }
}

/**
 * Build the order that posts an offer. The offered goods lock as soon as the
 * order is queued (spec §7; M2.E02).
 */
export function createOfferOrder(draft: OfferDraft): OrderDraft {
  validatePostExpiry(draft.expiryTicks);
  return {
    type: "post_offer",
    payload: {
      gives: positiveStacks(draft.gives, "An offer's goods"),
      wants: positiveStacks(draft.wants, "An offer's request"),
      expiryTicks: draft.expiryTicks,
    },
  };
}

/**
 * Build the order that cancels a post and releases its locks (spec §7; M6.04).
 *
 * Only the poster can cancel an open post. The locked goods are released and the post
 * transitions to cancelled status. Cancelling a parent automatically cascades to its
 * counter-offers.
 */
export interface CancelOfferDraft {
  offerId: string;
}

export function createCancelOfferOrder(draft: CancelOfferDraft): OrderDraft {
  if (!draft.offerId || draft.offerId.length === 0) {
    throw new Error("Choose a post to cancel.");
  }
  return {
    type: "cancel_offer",
    payload: {
      offerId: draft.offerId,
    },
  };
}

/**
 * Build the order that posts a wanted request. Wanted requests lock nothing and
 * settle through counter-offers (spec §7; M2.E03).
 */
export function createWantedRequestOrder(draft: WantedRequestDraft): OrderDraft {
  validatePostExpiry(draft.expiryTicks);
  if (!Number.isInteger(draft.quantity) || draft.quantity <= 0) {
    throw new Error("Wanted request quantity must be a positive whole number.");
  }
  return {
    type: "post_wanted_request",
    payload: {
      wants: positiveStacks(draft.wants, "A wanted request's goods"),
      quantity: draft.quantity,
      expiryTicks: draft.expiryTicks,
    },
  };
}

export interface CounterOfferDraft {
  parentOfferId: string;
  gives: ItemStack[];
  wants: ItemStack[];
}

export interface AcceptOfferDraft {
  offerId: string;
}

/**
 * Build the order that accepts an open offer or counter-offer. The accepter's
 * side locks at queue time and the trade settles at the tick (spec §7; M6.05).
 */
export function createAcceptOfferOrder(draft: AcceptOfferDraft): OrderDraft {
  if (!draft.offerId || draft.offerId.length === 0) {
    throw new Error("Choose a post to accept.");
  }
  return {
    type: "accept_offer",
    payload: {
      offerId: draft.offerId,
    },
  };
}

/**
 * Build the order that posts a counter-offer against an open offer or wanted
 * request. The counter locks only the counterer's goods; a wanted request's
 * wanter side locks when they accept (spec §7; M2.E04, M2.E06).
 */
export function createCounterOfferOrder(draft: CounterOfferDraft): OrderDraft {
  if (!draft.parentOfferId || draft.parentOfferId.length === 0) {
    throw new Error("Choose a post to counter.");
  }
  return {
    type: "counter_offer",
    payload: {
      parentOfferId: draft.parentOfferId,
      gives: positiveStacks(draft.gives, "A counter-offer's goods"),
      wants: positiveStacks(draft.wants, "A counter-offer's request"),
    },
  };
}
