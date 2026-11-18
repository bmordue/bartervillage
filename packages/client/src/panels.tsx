/**
 * Orders, barter board and inventory panels (M5.A03).
 *
 * These panels are read-only views. Queue editing arrives in M5.B02, the
 * inventory detail in M5.B05 and the full barter board in M6.01.
 */

import { useState } from "preact/hooks";

import { content } from "@bartervillage/content";
import { orderEnergyCost, type OrderType } from "@bartervillage/rules";

import { expandTileBatch, type BatchLayout, type BatchMode } from "./batch.js";
import { validateOrderDraft } from "./orderValidation.js";
import type { BarterOffer, ItemStack } from "./barter.js";
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
}

export function BarterPanel({ offers = [] }: BarterPanelProps) {
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
            </li>
          ))}
        </ul>
      )}
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
