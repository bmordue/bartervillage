/**
 * Barter board rules (spec §7, §13, §14.4g).
 *
 * Posts are one of three kinds: an offer locks the poster's goods, a wanted
 * request locks nothing, and a counter-offer locks only the counterer's side.
 * Acceptance locks the accepter's side and resolves as an all-or-nothing trade.
 * All board activity is public and board-wide; no travel is involved.
 */

import type { EventLog } from "./events.js";
import { addItems, canAddItems, consumeLockedItems, lockItems, unlockItems } from "./inventory.js";
import {
  orderFailed,
  orderSucceeded,
  registerOrderHandler,
  type OrderExecutionContext,
  type OrderOutcome,
} from "./orders.js";
import type {
  AcceptOfferPayload,
  CancelOfferPayload,
  ContentPack,
  CounterOfferPayload,
  EventPayloadMap,
  EventType,
  ItemStack,
  Offer,
  OfferId,
  PlayerId,
  PlotId,
  PostOfferPayload,
  PostWantedRequestPayload,
  WorldState,
} from "./types.js";
import {
  freeQuantity,
  lockedQuantity,
  orderEnergyCost,
  plotOfPlayer,
  spendEnergy,
  totalQuantity,
} from "./world.js";

export const MAX_OPEN_POSTS = 10;
export const MIN_OFFER_EXPIRY_TICKS = 1;
export const MAX_OFFER_EXPIRY_TICKS = 28;

/**
 * Handlers are registered with `registerOrderHandler`, whose context does not
 * yet carry an event log. The engine wires one in; when absent the handlers
 * still mutate state and the caller is responsible for the replay events.
 */
type BarterOrderContext = OrderExecutionContext & { events?: EventLog };

function eventsOf(context: OrderExecutionContext): EventLog | undefined {
  return (context as BarterOrderContext).events;
}

function emitEvent<K extends EventType>(
  events: EventLog | undefined,
  type: K,
  payload: EventPayloadMap[K],
): void {
  events?.emit(type, payload);
}

function cloneStacks(stacks: readonly ItemStack[]): ItemStack[] {
  return stacks.map((stack) => ({ item: stack.item, quantity: stack.quantity }));
}

function hasPositiveStacks(stacks: readonly ItemStack[]): boolean {
  return (
    stacks.length > 0 &&
    stacks.every((stack) => Number.isInteger(stack.quantity) && stack.quantity > 0)
  );
}

function offerById(state: WorldState, offerId: OfferId | null | undefined): Offer | undefined {
  if (offerId === null || offerId === undefined) {
    return undefined;
  }
  return state.offers.find((offer) => offer.id === offerId);
}

function releasePostLocks(state: WorldState, offer: Offer): void {
  const plot = plotOfPlayer(state, offer.posterId);
  if (!plot) {
    return;
  }
  unlockItems(state, plot.id, offer.gives);
}

function cancelChildPosts(
  state: WorldState,
  events: EventLog | undefined,
  parentOfferId: OfferId,
  exceptOfferId?: OfferId,
): void {
  const children = state.offers.filter(
    (offer) =>
      offer.parentOfferId === parentOfferId &&
      offer.status === "open" &&
      offer.id !== exceptOfferId,
  );
  for (const child of children) {
    releasePostLocks(state, child);
    child.status = "cancelled";
    emitEvent(events, "post_cancelled", {
      offerId: child.id,
      reason: "cascade",
    });
  }
}

function cancelOpenPost(
  state: WorldState,
  events: EventLog | undefined,
  offer: Offer,
  reason: "cancelled" | "cascade" | "settled",
  exceptChildId?: OfferId,
): void {
  if (offer.status !== "open") {
    return;
  }
  releasePostLocks(state, offer);
  offer.status = "cancelled";
  emitEvent(events, "post_cancelled", { offerId: offer.id, reason });
  cancelChildPosts(state, events, offer.id, exceptChildId);
}

function expireOpenPost(state: WorldState, events: EventLog, offer: Offer): void {
  if (offer.status !== "open") {
    return;
  }
  releasePostLocks(state, offer);
  offer.status = "expired";
  events.emit("post_expired", { offerId: offer.id });
  cancelChildPosts(state, events, offer.id);
}

/**
 * Expire every post whose `expiryTick` has passed. Posts made at tick T are
 * acceptable through `expiryTick`, so they expire once `expiryTick < tick`.
 * Counter-offers whose parent is no longer open are cancelled as a cascade.
 */
export function expirePosts(state: WorldState, events: EventLog): void {
  const tick = state.world.currentTick;
  const snapshot = [...state.offers];

  for (const offer of snapshot) {
    if (offer.kind !== "counter_offer" && offer.status === "open" && offer.expiryTick < tick) {
      expireOpenPost(state, events, offer);
    }
  }

  for (const offer of snapshot) {
    if (offer.status === "open" && offer.expiryTick < tick) {
      expireOpenPost(state, events, offer);
    }
  }

  for (const offer of snapshot) {
    if (offer.status !== "open" || offer.kind !== "counter_offer") {
      continue;
    }
    const parent = offerById(state, offer.parentOfferId);
    if (!parent || parent.status !== "open") {
      cancelOpenPost(state, events, offer, "cascade");
    }
  }
}

/** Open offers, wanted requests and counter-offers posted by a player. */
export function openPostCount(state: WorldState, playerId: PlayerId): number {
  return state.offers.filter((offer) => offer.posterId === playerId && offer.status === "open")
    .length;
}

/** Expiry is configurable from 1 to 28 ticks (spec §7). */
export function validateOfferExpiry(expiryTicks: number): boolean {
  return (
    Number.isInteger(expiryTicks) &&
    expiryTicks >= MIN_OFFER_EXPIRY_TICKS &&
    expiryTicks <= MAX_OFFER_EXPIRY_TICKS
  );
}

function canLockFreeStock(
  state: WorldState,
  playerId: PlayerId,
  stacks: readonly ItemStack[],
): boolean {
  const plot = plotOfPlayer(state, playerId);
  if (!plot) {
    return false;
  }
  return stacks.every((stack) => freeQuantity(state, plot.id, stack.item) >= stack.quantity);
}

function lockedStockAvailable(
  state: WorldState,
  playerId: PlayerId,
  stacks: readonly ItemStack[],
): boolean {
  const plot = plotOfPlayer(state, playerId);
  if (!plot) {
    return false;
  }
  return stacks.every((stack) => lockedQuantity(state, plot.id, stack.item) >= stack.quantity);
}

/**
 * Capacity after a trade, including locked goods. The outgoing goods are
 * consumed first, so only the net incoming quantity needs free space.
 */
function canHoldTradeResult(
  state: WorldState,
  content: ContentPack,
  playerId: PlayerId,
  outgoing: readonly ItemStack[],
  incoming: readonly ItemStack[],
): boolean {
  const plot = plotOfPlayer(state, playerId);
  if (!plot) {
    return false;
  }
  const netIncoming = totalQuantity(incoming) - totalQuantity(outgoing);
  if (netIncoming <= 0) {
    return true;
  }
  const anchor = incoming[0]?.item ?? "__trade__";
  return canAddItems(state, content, plot.id, [{ item: anchor, quantity: netIncoming }]);
}

function acceptableThisTick(offer: Offer, tick: number): boolean {
  return tick >= offer.createdAtTick + 1 && tick <= offer.expiryTick;
}

/** Register the five barter order handlers. Safe to call more than once. */
export function registerBarterHandlers(): void {
  registerOrderHandler("post_offer", (context): OrderOutcome => {
    const { state, content, player } = context;
    const payload = context.order.payload as PostOfferPayload;
    if (!hasPositiveStacks(payload.gives)) {
      return orderFailed("Offer must give at least one item with a positive quantity");
    }
    if (!hasPositiveStacks(payload.wants)) {
      return orderFailed("Offer must want at least one item with a positive quantity");
    }
    if (!validateOfferExpiry(payload.expiryTicks)) {
      return orderFailed("Expiry must be between 1 and 28 ticks");
    }
    if (openPostCount(state, player.id) >= MAX_OPEN_POSTS) {
      return orderFailed(`At most ${MAX_OPEN_POSTS} open posts are allowed`);
    }
    if (!canLockFreeStock(state, player.id, payload.gives)) {
      return orderFailed("Not enough free stock for the offered goods");
    }
    const cost = orderEnergyCost(content, context.order.type);
    if (player.energy < cost) {
      return orderFailed(`Not enough energy (needs ${cost})`);
    }

    lockItems(state, player.plotId, payload.gives);
    spendEnergy(player, cost);
    const expiryTick = state.world.currentTick + payload.expiryTicks;
    const offer: Offer = {
      id: `offer:${context.order.id}`,
      posterId: player.id,
      kind: "offer",
      gives: cloneStacks(payload.gives),
      wants: cloneStacks(payload.wants),
      quantity: 1,
      createdAtTick: state.world.currentTick,
      expiryTick,
      status: "open",
      parentOfferId: null,
    };
    state.offers.push(offer);
    emitEvent(eventsOf(context), "post_created", {
      offerId: offer.id,
      posterId: offer.posterId,
      kind: offer.kind,
      expiryTick: offer.expiryTick,
      parentOfferId: offer.parentOfferId,
    });
    return orderSucceeded;
  });

  registerOrderHandler("post_wanted_request", (context): OrderOutcome => {
    const { state, content, player } = context;
    const payload = context.order.payload as PostWantedRequestPayload;
    if (!hasPositiveStacks(payload.wants)) {
      return orderFailed("Wanted request must want at least one item with a positive quantity");
    }
    if (!Number.isInteger(payload.quantity) || payload.quantity <= 0) {
      return orderFailed("Wanted request quantity must be a positive integer");
    }
    if (!validateOfferExpiry(payload.expiryTicks)) {
      return orderFailed("Expiry must be between 1 and 28 ticks");
    }
    if (openPostCount(state, player.id) >= MAX_OPEN_POSTS) {
      return orderFailed(`At most ${MAX_OPEN_POSTS} open posts are allowed`);
    }
    const cost = orderEnergyCost(content, context.order.type);
    if (player.energy < cost) {
      return orderFailed(`Not enough energy (needs ${cost})`);
    }

    spendEnergy(player, cost);
    const offer: Offer = {
      id: `offer:${context.order.id}`,
      posterId: player.id,
      kind: "wanted_request",
      gives: [],
      wants: cloneStacks(payload.wants),
      quantity: payload.quantity,
      createdAtTick: state.world.currentTick,
      expiryTick: state.world.currentTick + payload.expiryTicks,
      status: "open",
      parentOfferId: null,
    };
    state.offers.push(offer);
    emitEvent(eventsOf(context), "post_created", {
      offerId: offer.id,
      posterId: offer.posterId,
      kind: offer.kind,
      expiryTick: offer.expiryTick,
      parentOfferId: offer.parentOfferId,
    });
    return orderSucceeded;
  });

  registerOrderHandler("counter_offer", (context): OrderOutcome => {
    const { state, content, player } = context;
    const payload = context.order.payload as CounterOfferPayload;
    if (!hasPositiveStacks(payload.gives)) {
      return orderFailed("Counter-offer must give at least one item with a positive quantity");
    }
    if (!hasPositiveStacks(payload.wants)) {
      return orderFailed("Counter-offer must want at least one item with a positive quantity");
    }
    const parent = offerById(state, payload.parentOfferId);
    if (!parent) {
      return orderFailed(`Unknown parent post ${payload.parentOfferId}`);
    }
    if (parent.status !== "open") {
      return orderFailed(`Parent post ${parent.id} is not open`);
    }
    if (parent.kind === "counter_offer") {
      return orderFailed("Counter-offers may not themselves be countered");
    }
    if (parent.posterId === player.id) {
      return orderFailed("A player cannot counter their own post");
    }
    if (parent.expiryTick < state.world.currentTick) {
      return orderFailed(`Parent post ${parent.id} has expired`);
    }
    if (openPostCount(state, player.id) >= MAX_OPEN_POSTS) {
      return orderFailed(`At most ${MAX_OPEN_POSTS} open posts are allowed`);
    }
    if (!canLockFreeStock(state, player.id, payload.gives)) {
      return orderFailed("Not enough free stock for the counter-offer goods");
    }
    const cost = orderEnergyCost(content, context.order.type);
    if (player.energy < cost) {
      return orderFailed(`Not enough energy (needs ${cost})`);
    }

    lockItems(state, player.plotId, payload.gives);
    spendEnergy(player, cost);
    const offer: Offer = {
      id: `offer:${context.order.id}`,
      posterId: player.id,
      kind: "counter_offer",
      gives: cloneStacks(payload.gives),
      wants: cloneStacks(payload.wants),
      quantity: 1,
      createdAtTick: state.world.currentTick,
      expiryTick: parent.expiryTick,
      status: "open",
      parentOfferId: parent.id,
    };
    state.offers.push(offer);
    emitEvent(eventsOf(context), "post_created", {
      offerId: offer.id,
      posterId: offer.posterId,
      kind: offer.kind,
      expiryTick: offer.expiryTick,
      parentOfferId: offer.parentOfferId,
    });
    return orderSucceeded;
  });

  registerOrderHandler("cancel_offer", (context): OrderOutcome => {
    const { state, content, player } = context;
    const payload = context.order.payload as CancelOfferPayload;
    const offer = offerById(state, payload.offerId);
    if (!offer) {
      return orderFailed(`Unknown post ${payload.offerId}`);
    }
    if (offer.status !== "open") {
      return orderFailed(`Post ${offer.id} is not open`);
    }
    if (offer.posterId !== player.id) {
      return orderFailed("Only the poster can cancel a post");
    }
    const cost = orderEnergyCost(content, context.order.type);
    if (player.energy < cost) {
      return orderFailed(`Not enough energy (needs ${cost})`);
    }

    spendEnergy(player, cost);
    cancelOpenPost(state, eventsOf(context), offer, "cancelled");
    return orderSucceeded;
  });

  registerOrderHandler("accept_offer", (context): OrderOutcome => {
    const { state, content, player } = context;
    const payload = context.order.payload as AcceptOfferPayload;
    const tick = state.world.currentTick;
    const offer = offerById(state, payload.offerId);
    if (!offer) {
      return orderFailed(`Unknown post ${payload.offerId}`);
    }
    if (offer.status !== "open") {
      return orderFailed(`Post ${offer.id} is not open`);
    }
    if (offer.kind === "wanted_request") {
      return orderFailed("A wanted request cannot be accepted directly");
    }
    if (!acceptableThisTick(offer, tick)) {
      return orderFailed(`Post ${offer.id} is not acceptable this tick`);
    }
    if (offer.posterId === player.id) {
      return orderFailed("A player cannot accept their own post");
    }

    let parent: Offer | undefined;
    if (offer.kind === "counter_offer") {
      parent = offerById(state, offer.parentOfferId);
      if (!parent) {
        return orderFailed(`Unknown parent post ${offer.parentOfferId ?? ""}`);
      }
      if (parent.status !== "open") {
        return orderFailed(`Parent post ${parent.id} is not open`);
      }
      if (parent.posterId !== player.id) {
        return orderFailed("Only the parent poster can accept a counter-offer");
      }
    }

    const seller = plotOfPlayer(state, offer.posterId);
    if (!seller) {
      return orderFailed("Poster has no plot");
    }
    const buyer = plotOfPlayer(state, player.id);
    if (!buyer) {
      return orderFailed("Player has no plot");
    }
    if (!canLockFreeStock(state, player.id, offer.wants)) {
      return orderFailed("Not enough free stock to accept this post");
    }
    if (!lockedStockAvailable(state, offer.posterId, offer.gives)) {
      return orderFailed("The post no longer has its goods locked");
    }
    if (!canHoldTradeResult(state, content, offer.posterId, offer.gives, offer.wants)) {
      return orderFailed("The poster lacks storage capacity for this trade");
    }
    if (!canHoldTradeResult(state, content, player.id, offer.wants, offer.gives)) {
      return orderFailed("The accepter lacks storage capacity for this trade");
    }
    const cost = orderEnergyCost(content, context.order.type);
    if (player.energy < cost) {
      return orderFailed(`Not enough energy (needs ${cost})`);
    }

    lockItems(state, player.plotId, offer.wants);
    spendEnergy(player, cost);

    const sellerConsumed = consumeLockedItems(state, seller.id, offer.gives);
    const buyerConsumed = consumeLockedItems(state, buyer.id, offer.wants);
    if (!sellerConsumed || !buyerConsumed) {
      unlockItems(state, player.plotId, offer.wants);
      return orderFailed("The trade could not be completed");
    }
    addItemsToPlot(state, content, seller.id, offer.wants);
    addItemsToPlot(state, content, player.plotId, offer.gives);

    offer.status = "settled";
    emitEvent(eventsOf(context), "trade_completed", {
      offerId: offer.id,
      parentOfferId: offer.parentOfferId,
      buyerId: player.id,
      sellerId: offer.posterId,
      gives: cloneStacks(offer.gives),
      wants: cloneStacks(offer.wants),
    });

    if (offer.kind === "counter_offer") {
      if (parent) {
        cancelOpenPost(state, eventsOf(context), parent, "settled", offer.id);
      }
    } else {
      cancelChildPosts(state, eventsOf(context), offer.id);
    }
    return orderSucceeded;
  });
}

function addItemsToPlot(
  state: WorldState,
  content: ContentPack,
  plotId: PlotId,
  stacks: readonly ItemStack[],
): void {
  // Capacity was checked before any mutation; this should always succeed.
  if (stacks.length === 0) {
    return;
  }
  addItems(state, content, plotId, stacks);
}
