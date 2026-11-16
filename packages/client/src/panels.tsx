/**
 * Orders, barter board and inventory panels (M5.A03).
 *
 * These panels are read-only views. Queue editing arrives in M5.B02, the
 * inventory detail in M5.B05 and the full barter board in M6.01.
 */

import type { BarterOffer, ItemStack } from "./barter.js";
import type { InventoryItem } from "./inventory.js";
import type { QueuedOrder } from "./orders.js";
import { Panel } from "./panel.js";

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

export interface OrderPanelProps {
  orders?: QueuedOrder[] | undefined;
}

export function OrderPanel({ orders = [] }: OrderPanelProps) {
  return (
    <Panel title="Orders">
      {orders.length === 0 ? (
        <p class="empty-state">No orders queued for this tick.</p>
      ) : (
        <ol class="order-list">
          {orders.map((order) => (
            <li key={order.id} class="order-item">
              <span class="order-sequence">#{order.sequence}</span>
              <span class="order-type">{humanize(order.type)}</span>
              {order.failureReason ? (
                <span class="order-failure">{order.failureReason}</span>
              ) : null}
            </li>
          ))}
        </ol>
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
                <span class="offer-poster">{offer.posterId}</span>
              </div>
              <p class="offer-trade">{describeOffer(offer)}</p>
              <p class="offer-meta">
                Qty {offer.quantity} · expires tick {offer.expiryTick}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export interface InventoryPanelProps {
  items?: InventoryItem[] | undefined;
}

export function InventoryPanel({ items = [] }: InventoryPanelProps) {
  return (
    <Panel title="Inventory">
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
        </table>
      )}
    </Panel>
  );
}
