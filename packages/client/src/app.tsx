/**
 * Preact application shell (spec §11; M5.A01).
 *
 * Desktop-first layout: a status header, a large world viewport and a right-hand
 * stack of panels. The PixiJS map (M5.A02) fills the viewport and the order,
 * barter board and inventory panels (M5.A03) fill the sidebar.
 */

import { useState } from "preact/hooks";

import type { BarterOffer } from "./barter.js";
import type { HelpChore } from "./help.js";
import type { InventoryItem } from "./inventory.js";
import { MapCanvas } from "./map/MapCanvas.js";
import type { MapView } from "./map/geometry.js";
import type { OrderDraft, QueuedOrder } from "./orders.js";
import { Panel } from "./panel.js";
import { BarterPanel, InventoryPanel, OrderPanel, PlayersPanel } from "./panels.js";
import type { PlayerStatus } from "./player.js";
import type { PlayerSummary } from "./players.js";
import type { PlotSnapshot } from "./plot.js";
import { PlotView } from "./plotView.js";
import type { WorldSnapshot } from "./world.js";

export { Panel } from "./panel.js";
export type { PanelProps } from "./panel.js";

export interface AppProps {
  title?: string;
  notice?: string | null;
  world?: WorldSnapshot;
  player?: PlayerStatus;
  mapView?: MapView;
  plot?: PlotSnapshot;
  viewedPlot?: PlotSnapshot;
  players?: PlayerSummary[];
  currentPlayerId?: string | undefined;
  orders?: QueuedOrder[];
  orderFailures?: QueuedOrder[];
  failureTick?: number | null;
  offers?: BarterOffer[];
  inventory?: InventoryItem[];
  onAddOrder?: (draft: OrderDraft) => void | Promise<void>;
  onAddOrders?: (drafts: OrderDraft[]) => void | Promise<void>;
  onRemoveOrder?: (orderId: string) => void | Promise<void>;
  onReorderOrders?: (orderIds: string[]) => void | Promise<void>;
  onViewPlot?: (plotId: string) => void | Promise<void>;
  onCloseViewedPlot?: () => void;
  onHelp?: (targetPlotId: string, chore: HelpChore) => void | Promise<void>;
  onToggleReady?: (ready: boolean) => void | Promise<void>;
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

function ReadyToggle({
  player,
  onToggleReady,
}: {
  player?: PlayerStatus | undefined;
  onToggleReady?: ((ready: boolean) => void | Promise<void>) | undefined;
}) {
  const [pending, setPending] = useState(false);
  if (!player || !onToggleReady) {
    return null;
  }

  const ready = player.ready;
  return (
    <Panel title="Ready for tick">
      <div class="ready-row">
        <strong class={ready ? "ready-state ready-state-on" : "ready-state"}>
          {ready ? "Ready" : "Not ready"}
        </strong>
        <button
          type="button"
          class="ready-toggle"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void Promise.resolve(onToggleReady(ready === null))
              .catch(() => undefined)
              .finally(() => setPending(false));
          }}
        >
          {ready ? "Cancel ready" : "Ready"}
        </button>
      </div>
      <p class="ready-hint">
        {ready
          ? `Ready at position ${ready.position}. Cancel to edit your queue.`
          : "The queue is fixed once the tick starts."}
      </p>
    </Panel>
  );
}

function Viewport({
  mapView,
  plot,
  viewedPlot,
  onCloseViewedPlot,
  onHelp,
  helperEnergy,
}: {
  mapView?: MapView | undefined;
  plot?: PlotSnapshot | undefined;
  viewedPlot?: PlotSnapshot | undefined;
  onCloseViewedPlot?: (() => void) | undefined;
  onHelp?: ((targetPlotId: string, chore: HelpChore) => void | Promise<void>) | undefined;
  helperEnergy?: number | undefined;
}) {
  const [selectedView, setSelectedView] = useState<"world" | "plot" | null>(null);
  const activeView = selectedView ?? (plot ? "plot" : "world");

  if (viewedPlot) {
    return (
      <section class="viewport" aria-label="World view">
        <div class="plot-viewed-banner">
          <span>Viewing {viewedPlot.plot.id} (read-only)</span>
          {onCloseViewedPlot ? (
            <button type="button" class="view-tab view-tab-active" onClick={onCloseViewedPlot}>
              Back to my plot
            </button>
          ) : null}
        </div>
        <PlotView
          plot={viewedPlot}
          readOnly
          helperEnergy={helperEnergy}
          {...(onHelp ? { onHelp: (chore: HelpChore) => onHelp(viewedPlot.plot.id, chore) } : {})}
        />
      </section>
    );
  }

  return (
    <section class="viewport" aria-label="World view">
      {plot || mapView ? (
        <nav class="view-switch" aria-label="Map view">
          <button
            type="button"
            class={activeView === "plot" ? "view-tab view-tab-active" : "view-tab"}
            disabled={!plot}
            onClick={() => setSelectedView("plot")}
          >
            Plot
          </button>
          <button
            type="button"
            class={activeView === "world" ? "view-tab view-tab-active" : "view-tab"}
            disabled={!mapView}
            onClick={() => setSelectedView("world")}
          >
            World
          </button>
        </nav>
      ) : null}
      {activeView === "plot" && plot ? (
        <PlotView plot={plot} />
      ) : mapView ? (
        <MapCanvas view={mapView} />
      ) : (
        <div class="viewport-placeholder">
          <p>Map and replay render here.</p>
        </div>
      )}
    </section>
  );
}

export function App({
  title = "Barter Village",
  notice,
  world,
  player,
  mapView,
  plot,
  viewedPlot,
  players,
  currentPlayerId,
  orders,
  orderFailures,
  failureTick,
  offers,
  inventory,
  onAddOrder,
  onAddOrders,
  onRemoveOrder,
  onReorderOrders,
  onViewPlot,
  onCloseViewedPlot,
  onHelp,
  onToggleReady,
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
        {notice ? (
          <p class="app-notice" role="status">
            {notice}
          </p>
        ) : null}
      </header>

      <main class="app-main">
        <Viewport
          mapView={mapView}
          plot={plot}
          viewedPlot={viewedPlot}
          onCloseViewedPlot={onCloseViewedPlot}
          onHelp={onHelp}
          helperEnergy={player?.player.energy}
        />

        <aside class="sidebar" aria-label="Game panels">
          <ReadyToggle player={player} onToggleReady={onToggleReady} />
          <OrderPanel
            orders={orders}
            failures={orderFailures}
            failureTick={failureTick}
            availableEnergy={player?.player.energy}
            onAddOrder={onAddOrder}
            onAddOrders={onAddOrders}
            onRemoveOrder={onRemoveOrder}
            onReorderOrders={onReorderOrders}
          />
          <BarterPanel
            offers={offers}
            inventory={inventory}
            currentPlayerId={currentPlayerId}
            {...(onAddOrder ? { onAddOrder } : {})}
          />
          <InventoryPanel items={inventory} storage={plot?.storage} />
          <PlayersPanel
            players={players}
            currentPlayerId={currentPlayerId}
            onViewPlot={onViewPlot}
          />
        </aside>
      </main>

      <footer class="app-footer">
        <span>Desktop-first layout</span>
      </footer>
    </div>
  );
}
