/**
 * Preact application shell (spec §11; M5.A01).
 *
 * Desktop-first layout: a status header, a large world viewport and a right-hand
 * stack of panels. The PixiJS map (M5.A02) fills the viewport and the order,
 * barter board and inventory panels (M5.A03) fill the sidebar.
 */

import type { BarterOffer } from "./barter.js";
import type { InventoryItem } from "./inventory.js";
import { MapCanvas } from "./map/MapCanvas.js";
import type { MapView } from "./map/geometry.js";
import type { OrderDraft, QueuedOrder } from "./orders.js";
import { BarterPanel, InventoryPanel, OrderPanel } from "./panels.js";
import type { PlayerStatus } from "./player.js";
import type { WorldSnapshot } from "./world.js";

export { Panel } from "./panel.js";
export type { PanelProps } from "./panel.js";

export interface AppProps {
  title?: string;
  world?: WorldSnapshot;
  player?: PlayerStatus;
  mapView?: MapView;
  orders?: QueuedOrder[];
  offers?: BarterOffer[];
  inventory?: InventoryItem[];
  onAddOrder?: (draft: OrderDraft) => void | Promise<void>;
  onRemoveOrder?: (orderId: string) => void | Promise<void>;
  onReorderOrders?: (orderIds: string[]) => void | Promise<void>;
}

/** Placeholder status chip shown until live world data is wired in (M5.A04). */
function StatusItem({ label, value = "—" }: { label: string; value?: string | undefined }) {
  return (
    <span class="status-item">
      <span class="status-label">{label}</span>
      <strong class="status-value">{value}</strong>
    </span>
  );
}

export function App({
  title = "Barter Village",
  world,
  player,
  mapView,
  orders,
  offers,
  inventory,
  onAddOrder,
  onRemoveOrder,
  onReorderOrders,
}: AppProps) {
  return (
    <div class="app-shell" data-testid="app-shell">
      <header class="app-header">
        <div class="app-brand">
          <h1 class="app-title">{title}</h1>
          <p class="app-tagline">A shared, turn-based farming and crafting world</p>
        </div>
        <div class="world-status" aria-label="World status">
          <StatusItem label="Energy" value={player ? String(player.player.energy) : undefined} />
          <StatusItem label="Tick" value={world ? String(world.currentTick) : undefined} />
          <StatusItem label="Season" value={world?.season} />
          <StatusItem label="Weather" value={world?.weather} />
          <StatusItem label="Deadline" value={world?.nextDeadline} />
          <StatusItem
            label="Ready"
            value={player ? (player.ready ? "Ready" : "Not ready") : undefined}
          />
        </div>
      </header>

      <main class="app-main">
        <section class="viewport" aria-label="World view">
          {mapView ? (
            <MapCanvas view={mapView} />
          ) : (
            <div class="viewport-placeholder">
              <p>Map and replay render here.</p>
            </div>
          )}
        </section>

        <aside class="sidebar" aria-label="Game panels">
          <OrderPanel
            orders={orders}
            onAddOrder={onAddOrder}
            onRemoveOrder={onRemoveOrder}
            onReorderOrders={onReorderOrders}
          />
          <BarterPanel offers={offers} />
          <InventoryPanel items={inventory} />
        </aside>
      </main>

      <footer class="app-footer">
        <span>Desktop-first layout</span>
      </footer>
    </div>
  );
}
