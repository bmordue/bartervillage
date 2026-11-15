/**
 * Preact application shell (spec §11; M5.A01).
 *
 * Desktop-first layout: a status header, a large world viewport and a right-hand
 * stack of panels. Later milestone tasks fill the viewport with the PixiJS map
 * (M5.A02) and the panels with the order queue, barter board and inventory
 * (M5.A03).
 */

import type { ComponentChildren } from "preact";

import { MapCanvas } from "./map/MapCanvas.js";
import type { MapView } from "./map/geometry.js";
import type { PlayerStatus } from "./player.js";
import type { WorldSnapshot } from "./world.js";

export interface AppProps {
  title?: string;
  world?: WorldSnapshot;
  player?: PlayerStatus;
  mapView?: MapView;
}

export interface PanelProps {
  title: string;
  children?: ComponentChildren;
}

/** A titled panel in the right-hand sidebar. */
export function Panel({ title, children }: PanelProps) {
  return (
    <section class="panel" aria-label={title}>
      <h2 class="panel-title">{title}</h2>
      <div class="panel-body">{children}</div>
    </section>
  );
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

export function App({ title = "Barter Village", world, player, mapView }: AppProps) {
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
          <Panel title="Orders">
            <p>Queue orders before the tick.</p>
          </Panel>
          <Panel title="Barter board">
            <p>Offers and wanted requests from other plots.</p>
          </Panel>
          <Panel title="Inventory">
            <p>Held, locked and free stock.</p>
          </Panel>
        </aside>
      </main>

      <footer class="app-footer">
        <span>Desktop-first layout</span>
      </footer>
    </div>
  );
}
