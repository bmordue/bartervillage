/**
 * Browser entry point for the Preact client (M5.A01).
 *
 * Mounts the application shell into the `#app` element and polls the world,
 * current player, queued orders, barter board and inventory every five seconds
 * (M5.A04, M5.A05, M5.A03). Kept separate from the component tree so tests can
 * render `App` without a DOM.
 */

import { render } from "preact";
import { App } from "./app.js";
import { fetchBarter, type BarterOffer } from "./barter.js";
import { fetchInventory, type InventoryItem } from "./inventory.js";
import { createPreviewMapView } from "./map/preview.js";
import { fetchOrders, type QueuedOrder } from "./orders.js";
import { fetchPlayer, type PlayerStatus } from "./player.js";
import { createPoller } from "./polling.js";
import { fetchWorld, type WorldSnapshot } from "./world.js";

interface StatusSnapshot {
  world: WorldSnapshot;
  player: PlayerStatus | null;
  orders: QueuedOrder[];
  offers: BarterOffer[];
  inventory: InventoryItem[];
}

function currentPlayerId(): string {
  if (typeof window === "undefined") {
    return "p1";
  }
  return new URLSearchParams(window.location.search).get("player") ?? "p1";
}

/** Mount the application shell into `root`, or `#app` when omitted. */
export function mountApp(root?: HTMLElement | null): void {
  const target = root ?? document.getElementById("app");
  if (!target) {
    throw new Error('Client mount point "#app" not found');
  }

  // Placeholder region until the server exposes tiles (M5.A02 / M8.10 art).
  const mapView = createPreviewMapView();
  const playerId = currentPlayerId();

  const draw = (snapshot: Partial<StatusSnapshot> = {}): void => {
    render(
      <App
        {...(snapshot.world ? { world: snapshot.world } : {})}
        {...(snapshot.player ? { player: snapshot.player } : {})}
        {...(snapshot.orders ? { orders: snapshot.orders } : {})}
        {...(snapshot.offers ? { offers: snapshot.offers } : {})}
        {...(snapshot.inventory ? { inventory: snapshot.inventory } : {})}
        mapView={mapView}
      />,
      target,
    );
  };

  draw();

  const poller = createPoller<StatusSnapshot>({
    fetchData: async (signal) => {
      const world = await fetchWorld("", "w1", signal);
      const player = await fetchPlayer("", "w1", playerId, signal).catch(() => null);
      const [orders, offers, inventory] = await Promise.all([
        player
          ? fetchOrders("", "w1", player.player.id, signal).catch(() => [])
          : Promise.resolve([]),
        fetchBarter("", "w1", signal).catch(() => []),
        player
          ? fetchInventory("", "w1", player.player.plotId, signal).catch(() => [])
          : Promise.resolve([]),
      ]);
      return { world, player, orders, offers, inventory };
    },
    onData: (snapshot) => draw(snapshot),
    onError: (error) => {
      console.error("status poll failed", error);
    },
  });
  poller.start();

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => poller.stop(), { once: true });
  }
}

if (typeof document !== "undefined") {
  const root = document.getElementById("app");
  if (root) {
    mountApp(root);
  }
}
