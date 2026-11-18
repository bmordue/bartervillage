/**
 * Orders, barter board and inventory panels (M5.A03).
 *
 * The order panel edits the queue (M5.B02), the inventory panel shows stock
 * detail (M5.B05) and the barter panel lists the board plus the offer and
 * wanted-request flows (M6.01, M6.02).
 */

import { useState } from "preact/hooks";

import { content } from "@bartervillage/content";
import {
  MAX_OFFER_EXPIRY_TICKS,
  MIN_OFFER_EXPIRY_TICKS,
  orderEnergyCost,
  type OrderType,
} from "@bartervillage/rules";

import { expandTileBatch, type BatchLayout, type BatchMode } from "./batch.js";
import {
  createCancelOfferOrder,
  createCounterOfferOrder,
  createOfferOrder,
  createStack,
  createWantedRequestOrder,
  DEFAULT_EXPIRY_TICKS,
  type BarterOffer,
  type BarterPostKind,
  type ItemStack,
} from "./barter.js";
import { validateOrderDraft } from "./orderValidation.js";
import type { InventoryItem } from "./inventory.js";
import { moveOrder, type OrderDraft, type QueuedOrder } from "./orders.js";
import { Panel } from "./panel.js";
import type { PlayerSummary } from "./players.js";
import type { StorageSummary } from "./plot.js";

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

function describeOffer(offer: BarterOffer): string {
  switch (offer.kind) {
    case "wanted_request":
      return `Wants ${describeStacks(offer.wants)}`;
    case "counter_offer":
      return `Counters with ${describeStacks(offer.gives)} for ${describeStacks(offer.wants)}`;
    default:
      return `Gives ${describeStacks(offer.gives)} for ${describeStacks(offer.wants)}`;
  }
}

function describeFreeStock(stock: { item: string; free: number }[]): string {
  return stock.map((entry) => `${entry.free} ${humanize(entry.item)}`).join(", ");
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "wanted_request":
      return "Wanted";
    case "counter_offer":
      return "Counter-offer";
    default:
      return "Offer";
  }
}

const ORDER_TYPE_OPTIONS = [
  "plant",
  "harvest",
  "tend",
  "feed",
  "build",
  "upgrade",
  "craft",
  "travel",
  "help",
  "gift",
  "forage",
  "fish",
  "post_offer",
  "post_wanted_request",
  "cancel_offer",
  "accept_offer",
  "counter_offer",
  "contribute_goal",
  "place_decoration",
] as const;

const ORDER_TEMPLATES: Record<string, string> = {
  plant: '{\n  "tile": { "x": 0, "y": 0 },\n  "crop": "wheat"\n}',
  harvest: '{\n  "tile": { "x": 0, "y": 0 }\n}',
  tend: '{\n  "tile": { "x": 0, "y": 0 }\n}',
  feed: '{\n  "animalId": "animal1"\n}',
  build: '{\n  "building": "home",\n  "tile": { "x": 0, "y": 0 }\n}',
  upgrade: '{\n  "buildingId": "building1"\n}',
  craft: '{\n  "buildingId": "building1",\n  "recipeId": "recipe1"\n}',
  travel: '{\n  "regionId": "r1"\n}',
  help: '{\n  "targetPlotId": "plot1",\n  "chore": "water",\n  "tile": { "x": 0, "y": 0 }\n}',
  gift: '{\n  "toPlayerId": "p2",\n  "items": [{ "item": "wheat", "quantity": 1 }]\n}',
  forage: '{\n  "nodeId": "node1"\n}',
  fish: '{\n  "nodeId": "node1"\n}',
  post_offer:
    '{\n  "gives": [{ "item": "wheat", "quantity": 1 }],\n  "wants": [{ "item": "wood", "quantity": 1 }],\n  "expiryTicks": 7\n}',
  post_wanted_request:
    '{\n  "wants": [{ "item": "wood", "quantity": 1 }],\n  "quantity": 1,\n  "expiryTicks": 7\n}',
  cancel_offer: '{\n  "offerId": "offer1"\n}',
  accept_offer: '{\n  "offerId": "offer1"\n}',
  counter_offer:
    '{\n  "parentOfferId": "offer1",\n  "gives": [{ "item": "wheat", "quantity": 1 }],\n  "wants": [{ "item": "wood", "quantity": 1 }]\n}',
  contribute_goal: '{\n  "goalId": "goal1",\n  "items": [{ "item": "wheat", "quantity": 1 }]\n}',
  place_decoration: '{\n  "decoration": "flower_patch",\n  "tile": { "x": 0, "y": 0 }\n}',
};

export interface OrderPanelProps {
  orders?: QueuedOrder[] | undefined;
  failures?: QueuedOrder[] | undefined;
  failureTick?: number | null | undefined;
  /** Last polled player energy; used for a light, non-authoritative check. */
  availableEnergy?: number | undefined;
  onAddOrder?: ((draft: OrderDraft) => void | Promise<void>) | undefined;
  onAddOrders?: ((drafts: OrderDraft[]) => void | Promise<void>) | undefined;
  onRemoveOrder?: ((orderId: string) => void | Promise<void>) | undefined;
  onReorderOrders?: ((orderIds: string[]) => void | Promise<void>) | undefined;
}

export interface OrderFailuresPanelProps {
  failures?: QueuedOrder[] | undefined;
  failureTick?: number | null | undefined;
}

export function OrderFailuresPanel({ failures = [], failureTick }: OrderFailuresPanelProps) {
  if (failures.length === 0) {
    return null;
  }
  return (
    <div class="order-failures">
      <h3 class="order-failures-title">Failed in tick {failureTick ?? "—"}</h3>
      <ul class="order-list">
        {failures.map((order) => (
          <li key={order.id} class="order-item">
            <span class="order-sequence">#{order.sequence}</span>
            <span class="order-type">{humanize(order.type)}</span>
            <span class="order-failure">{order.failureReason ?? "Order failed"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function OrderPanel({
  orders = [],
  failures = [],
  failureTick,
  availableEnergy,
  onAddOrder,
  onAddOrders,
  onRemoveOrder,
  onReorderOrders,
}: OrderPanelProps) {
  const [type, setType] = useState<string>("plant");
  const [payloadText, setPayloadText] = useState<string>(ORDER_TEMPLATES.plant ?? "{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState<BatchMode>("single");
  const [rowCount, setRowCount] = useState(4);
  const [areaWidth, setAreaWidth] = useState(2);
  const [areaHeight, setAreaHeight] = useState(2);

  const run = async (task: () => void | Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: Event): void => {
    event.preventDefault();
    if (!onAddOrder) {
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      setError("Order payload must be valid JSON.");
      return;
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      setError("Order payload must be a JSON object.");
      return;
    }
    const draft = { type, payload: payload as Record<string, unknown> };
    const energyCost = orderEnergyCost(content, type as OrderType);
    try {
      validateOrderDraft(draft, {
        ...(availableEnergy === undefined ? {} : { availableEnergy }),
        energyCost,
      });
    } catch (caught) {
      setError(errorMessage(caught));
      return;
    }
    if (onAddOrders && batchMode !== "single") {
      const layout: BatchLayout = {
        mode: batchMode,
        count: rowCount,
        width: areaWidth,
        height: areaHeight,
      };
      try {
        const drafts = expandTileBatch(draft, layout);
        void run(() => onAddOrders(drafts));
      } catch (caught) {
        setError(errorMessage(caught));
      }
      return;
    }
    void run(() => onAddOrder(draft));
  };

  const move = (index: number, direction: -1 | 1): void => {
    if (!onReorderOrders) {
      return;
    }
    const ids = orders.map((order) => order.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) {
      return;
    }
    void run(() => onReorderOrders(moveOrder(ids, index, target)));
  };

  return (
    <Panel title="Orders">
      {orders.length === 0 ? (
        <p class="empty-state">No orders queued for this tick.</p>
      ) : (
        <ol class="order-list">
          {orders.map((order, index) => (
            <li key={order.id} class="order-item">
              <span class="order-sequence">#{order.sequence}</span>
              <span class="order-type">{humanize(order.type)}</span>
              {order.failureReason ? (
                <span class="order-failure">{order.failureReason}</span>
              ) : null}
              {onReorderOrders ? (
                <span class="order-controls">
                  <button
                    type="button"
                    class="order-control"
                    aria-label={`Move ${order.type} order up`}
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    class="order-control"
                    aria-label={`Move ${order.type} order down`}
                    disabled={busy || index === orders.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Down
                  </button>
                </span>
              ) : null}
              {onRemoveOrder ? (
                <button
                  type="button"
                  class="order-control order-remove"
                  aria-label={`Remove ${order.type} order`}
                  disabled={busy}
                  onClick={() => void run(() => onRemoveOrder(order.id))}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <OrderFailuresPanel failures={failures} failureTick={failureTick} />

      {onAddOrder ? (
        <form class="order-form" onSubmit={submit}>
          <label class="order-field">
            <span>Order type</span>
            <select
              value={type}
              disabled={busy}
              onChange={(event) => {
                const next = (event.currentTarget as HTMLSelectElement).value;
                setType(next);
                setPayloadText(ORDER_TEMPLATES[next] ?? "{}");
                setError(null);
              }}
            >
              {ORDER_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {humanize(option)}
                </option>
              ))}
            </select>
          </label>
          {onAddOrders ? (
            <div class="order-batch">
              <label class="order-field">
                <span>Batch</span>
                <select
                  value={batchMode}
                  disabled={busy}
                  onChange={(event) => {
                    setBatchMode((event.currentTarget as HTMLSelectElement).value as BatchMode);
                    setError(null);
                  }}
                >
                  <option value="single">Single order</option>
                  <option value="row">Fill row</option>
                  <option value="area">Fill area</option>
                </select>
              </label>
              {batchMode === "row" ? (
                <label class="order-field">
                  <span>Row size</span>
                  <input
                    type="number"
                    min={1}
                    max={144}
                    value={rowCount}
                    disabled={busy}
                    onInput={(event) =>
                      setRowCount(Number((event.currentTarget as HTMLInputElement).value))
                    }
                  />
                </label>
              ) : null}
              {batchMode === "area" ? (
                <>
                  <label class="order-field">
                    <span>Width</span>
                    <input
                      type="number"
                      min={1}
                      max={144}
                      value={areaWidth}
                      disabled={busy}
                      onInput={(event) =>
                        setAreaWidth(Number((event.currentTarget as HTMLInputElement).value))
                      }
                    />
                  </label>
                  <label class="order-field">
                    <span>Height</span>
                    <input
                      type="number"
                      min={1}
                      max={144}
                      value={areaHeight}
                      disabled={busy}
                      onInput={(event) =>
                        setAreaHeight(Number((event.currentTarget as HTMLInputElement).value))
                      }
                    />
                  </label>
                </>
              ) : null}
              <p class="order-batch-hint">
                Each tile becomes its own order. The server validates every order.
              </p>
            </div>
          ) : null}
          <label class="order-field">
            <span>Payload (JSON)</span>
            <textarea
              rows={5}
              value={payloadText}
              disabled={busy}
              onInput={(event) =>
                setPayloadText((event.currentTarget as HTMLTextAreaElement).value)
              }
            />
          </label>
          {error ? <p class="order-error">{error}</p> : null}
          <button type="submit" class="order-add" disabled={busy}>
            {batchMode === "single" ? "Add order" : "Add orders"}
          </button>
        </form>
      ) : null}
    </Panel>
  );
}

export interface PlayersPanelProps {
  players?: PlayerSummary[] | undefined;
  currentPlayerId?: string | undefined;
  onViewPlot?: ((plotId: string) => void | Promise<void>) | undefined;
}

export function PlayersPanel({ players = [], currentPlayerId, onViewPlot }: PlayersPanelProps) {
  const others = players.filter((player) => player.id !== currentPlayerId);

  return (
    <Panel title="Villagers">
      {others.length === 0 ? (
        <p class="empty-state">No other villagers yet.</p>
      ) : (
        <ul class="player-list">
          {others.map((player) => (
            <li key={player.id} class="player-item">
              <span class="player-name">{player.name}</span>
              <span class="player-plot">{player.plotId}</span>
              {onViewPlot ? (
                <button
                  type="button"
                  class="player-view"
                  aria-label={`View ${player.name}'s plot`}
                  onClick={() => void onViewPlot(player.plotId)}
                >
                  View
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export interface BarterPanelProps {
  offers?: BarterOffer[] | undefined;
  inventory?: InventoryItem[] | undefined;
  currentPlayerId?: string | undefined;
  onAddOrder?: ((draft: OrderDraft) => void | Promise<void>) | undefined;
}

export function BarterPanel({
  offers = [],
  inventory = [],
  currentPlayerId,
  onAddOrder,
}: BarterPanelProps) {
  const [kind, setKind] = useState<BarterPostKind>("offer");
  const [counterParentId, setCounterParentId] = useState("");
  const [giveItem, setGiveItem] = useState<string>(inventory[0]?.item ?? "");
  const [giveQuantity, setGiveQuantity] = useState(1);
  const [wantItem, setWantItem] = useState<string>("");
  const [wantQuantity, setWantQuantity] = useState(1);
  const [requestQuantity, setRequestQuantity] = useState(1);
  const [expiryTicks, setExpiryTicks] = useState(DEFAULT_EXPIRY_TICKS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tradableItems = Object.keys(content.items).sort();
  const selectedStock = inventory.find((entry) => entry.item === giveItem);

  const submit = (event: Event): void => {
    event.preventDefault();
    if (!onAddOrder) {
      return;
    }
    let draft: OrderDraft;
    try {
      draft =
        kind === "counter_offer"
          ? createCounterOfferOrder({
              parentOfferId: counterParentId,
              gives: [createStack(giveItem, giveQuantity)],
              wants: [createStack(wantItem, wantQuantity)],
            })
          : kind === "offer"
            ? createOfferOrder({
                gives: [createStack(giveItem, giveQuantity)],
                wants: [createStack(wantItem, wantQuantity)],
                expiryTicks,
              })
            : createWantedRequestOrder({
                wants: [createStack(wantItem, wantQuantity)],
                quantity: requestQuantity,
                expiryTicks,
              });
    } catch (caught) {
      setError(errorMessage(caught));
      return;
    }
    setBusy(true);
    setError(null);
    void Promise.resolve(onAddOrder(draft))
      .catch((caught) => setError(errorMessage(caught)))
      .finally(() => setBusy(false));
  };

  const cancel = (offerId: string): void => {
    if (!onAddOrder) {
      return;
    }
    setBusy(true);
    setError(null);
    void Promise.resolve(onAddOrder(createCancelOfferOrder({ offerId })))
      .catch((caught) => setError(errorMessage(caught)))
      .finally(() => setBusy(false));
  };

  return (
    <Panel title="Barter board">
      {offers.length === 0 ? (
        <p class="empty-state">No open offers.</p>
      ) : (
        <ul class="offer-list">
          {offers.map((offer) => (
            <li key={offer.id} class="offer-item">
              <div class="offer-heading">
                <span class="offer-kind">{kindLabel(offer.kind)}</span>
                <span class="offer-poster">{offer.posterName ?? offer.posterId}</span>
              </div>
              <p class="offer-trade">{describeOffer(offer)}</p>
              <p class="offer-meta">
                Qty {offer.quantity} · expires tick {offer.expiryTick}
                {offer.kind === "counter_offer" && offer.parentOfferId
                  ? ` · counters ${offer.parentOfferId}`
                  : ""}
              </p>
              {offer.posterFreeStock && offer.posterFreeStock.length > 0 ? (
                <p class="offer-free">
                  Poster free stock: {describeFreeStock(offer.posterFreeStock)}
                </p>
              ) : null}
              {currentPlayerId && offer.status === "open" && offer.posterId === currentPlayerId ? (
                <button
                  type="button"
                  class="order-control order-remove"
                  aria-label={`Cancel post ${offer.id}`}
                  disabled={busy}
                  onClick={() => void cancel(offer.id)}
                >
                  Cancel post
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {onAddOrder ? (
        <form class="barter-form" onSubmit={submit}>
          <label class="order-field">
            <span>Post type</span>
            <select
              value={kind}
              disabled={busy}
              onChange={(event) => {
                setKind((event.currentTarget as HTMLSelectElement).value as BarterPostKind);
                setError(null);
              }}
            >
              <option value="offer">Offer</option>
              <option value="wanted_request">Wanted request</option>
              <option value="counter_offer">Counter-offer</option>
            </select>
          </label>

          {kind === "counter_offer" ? (
            <label class="order-field">
              <span>Parent post</span>
              <select
                value={counterParentId}
                disabled={busy}
                onChange={(event) => {
                  setCounterParentId((event.currentTarget as HTMLSelectElement).value);
                  setError(null);
                }}
              >
                <option value="">Choose a post to counter</option>
                {offers
                  .filter(
                    (offer) =>
                      offer.status === "open" &&
                      offer.kind !== "counter_offer" &&
                      offer.posterId !== currentPlayerId,
                  )
                  .map((offer) => (
                    <option key={offer.id} value={offer.id}>
                      {kindLabel(offer.kind)} from {offer.posterName ?? offer.posterId} —{" "}
                      {describeOffer(offer)}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}

          {kind !== "wanted_request" ? (
            <div class="barter-row">
              <label class="order-field">
                <span>Give item</span>
                <select
                  value={giveItem}
                  disabled={busy}
                  onChange={(event) => {
                    setGiveItem((event.currentTarget as HTMLSelectElement).value);
                    setError(null);
                  }}
                >
                  {inventory.length === 0 ? <option value="">No goods</option> : null}
                  {inventory.map((entry) => (
                    <option key={entry.item} value={entry.item}>
                      {humanize(entry.item)} ({entry.free} free)
                    </option>
                  ))}
                </select>
              </label>
              <label class="order-field">
                <span>Give qty</span>
                <input
                  type="number"
                  min={1}
                  value={giveQuantity}
                  disabled={busy}
                  onInput={(event) =>
                    setGiveQuantity(Number((event.currentTarget as HTMLInputElement).value))
                  }
                />
              </label>
            </div>
          ) : null}

          <div class="barter-row">
            <label class="order-field">
              <span>{kind === "wanted_request" ? "Wanted item" : "Want item"}</span>
              <select
                value={wantItem}
                disabled={busy}
                onChange={(event) => {
                  setWantItem((event.currentTarget as HTMLSelectElement).value);
                  setError(null);
                }}
              >
                <option value="">Choose an item</option>
                {tradableItems.map((item) => (
                  <option key={item} value={item}>
                    {humanize(item)}
                  </option>
                ))}
              </select>
            </label>
            <label class="order-field">
              <span>Want qty</span>
              <input
                type="number"
                min={1}
                value={wantQuantity}
                disabled={busy}
                onInput={(event) =>
                  setWantQuantity(Number((event.currentTarget as HTMLInputElement).value))
                }
              />
            </label>
          </div>

          {kind === "wanted_request" ? (
            <label class="order-field">
              <span>How many trades</span>
              <input
                type="number"
                min={1}
                value={requestQuantity}
                disabled={busy}
                onInput={(event) =>
                  setRequestQuantity(Number((event.currentTarget as HTMLInputElement).value))
                }
              />
            </label>
          ) : null}

          {kind !== "counter_offer" ? (
            <label class="order-field">
              <span>Expiry (ticks)</span>
              <input
                type="number"
                min={MIN_OFFER_EXPIRY_TICKS}
                max={MAX_OFFER_EXPIRY_TICKS}
                value={expiryTicks}
                disabled={busy}
                onInput={(event) =>
                  setExpiryTicks(Number((event.currentTarget as HTMLInputElement).value))
                }
              />
            </label>
          ) : null}

          {kind === "counter_offer" ? (
            <p class="barter-expiry-hint">
              Counters inherit the parent post's expiry and cannot themselves be countered.
            </p>
          ) : null}

          {kind === "counter_offer" ? (
            <p class="barter-lock">
              {giveQuantity > 0 && giveItem.length > 0
                ? `${giveQuantity} ${humanize(giveItem)} locks when queued`
                : "The counter's goods lock when queued"}
              {selectedStock ? ` (${selectedStock.free} free)` : ""}. Remove the order before the
              tick to release the lock.
            </p>
          ) : kind === "offer" ? (
            <p class="barter-lock">
              {giveQuantity > 0 && giveItem.length > 0
                ? `${giveQuantity} ${humanize(giveItem)} locks when queued`
                : "The offered goods lock when queued"}
              {selectedStock ? ` (${selectedStock.free} free)` : ""}. Remove the order before the
              tick to release the lock.
            </p>
          ) : (
            <p class="barter-lock barter-lock-none">Wanted requests lock no goods.</p>
          )}
          {kind !== "counter_offer" ? (
            <p class="barter-expiry-hint">
              Acceptable from the next tick and expires at the start of tick expiry + 1.
            </p>
          ) : null}

          {error ? <p class="order-error">{error}</p> : null}
          <button type="submit" class="order-add" disabled={busy}>
            {kind === "offer"
              ? "Queue offer"
              : kind === "counter_offer"
                ? "Queue counter-offer"
                : "Queue wanted request"}
          </button>
        </form>
      ) : null}
    </Panel>
  );
}

export interface InventoryPanelProps {
  items?: InventoryItem[] | undefined;
  storage?: StorageSummary | undefined;
}

export function InventoryPanel({ items = [], storage }: InventoryPanelProps) {
  const held = items.reduce((total, item) => total + item.quantity, 0);
  const locked = items.reduce((total, item) => total + item.locked, 0);
  const free = items.reduce((total, item) => total + item.free, 0);
  const fill = storage && storage.capacity > 0 ? Math.min(1, storage.used / storage.capacity) : 0;

  return (
    <Panel title="Inventory">
      {storage ? (
        <div class="inventory-capacity">
          <p class="inventory-capacity-label">
            {storage.used} / {storage.capacity} capacity · {storage.free} free
          </p>
          <div class="inventory-capacity-bar" aria-hidden="true">
            <span class="inventory-capacity-fill" style={{ width: `${fill * 100}%` }} />
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p class="empty-state">No stored goods.</p>
      ) : (
        <table class="inventory-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Held</th>
              <th scope="col">Locked</th>
              <th scope="col">Free</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.item}>
                <th scope="row">{humanize(item.item)}</th>
                <td>{item.quantity}</td>
                <td>{item.locked}</td>
                <td>{item.free}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td>{held}</td>
              <td>{locked}</td>
              <td>{free}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </Panel>
  );
}
