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
import type { InventoryItem } from "./inventory.js";
import { createPreviewMapView } from "./map/preview.js";
import {
  addOrder,
  fetchOrders,
  removeOrder,
  reorderOrders,
  TickInProgressError,
  type OrderDraft,
  type QueuedOrder,
} from "./orders.js";
import { fetchPlayer, type PlayerStatus } from "./player.js";
import { fetchPlot, type PlotSnapshot } from "./plot.js";
import { createPoller } from "./polling.js";
import { fetchWorld, type WorldSnapshot } from "./world.js";

interface StatusSnapshot {
  world: WorldSnapshot;
  player: PlayerStatus | null;
  orders: QueuedOrder[];
  offers: BarterOffer[];
  inventory: InventoryItem[];
  plot: PlotSnapshot | null;
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

  let latest: Partial<StatusSnapshot> = {};
  let notice: string | null = null;
  let draw: (snapshot?: Partial<StatusSnapshot>) => void = () => undefined;

  const poller = createPoller<StatusSnapshot>({
    fetchData: async (signal) => {
      const world = await fetchWorld("", "w1", signal);
      const player = await fetchPlayer("", "w1", playerId, signal).catch(() => null);
      const [orders, offers, plot] = await Promise.all([
        player
          ? fetchOrders("", "w1", player.player.id, signal).catch(() => [])
          : Promise.resolve([]),
        fetchBarter("", "w1", signal).catch(() => []),
        player
          ? fetchPlot("", "w1", player.player.plotId, signal).catch(() => null)
          : Promise.resolve(null),
      ]);
      return { world, player, orders, offers, inventory: plot?.inventory ?? [], plot };
    },
    onData: (snapshot) => {
      notice = null;
      draw(snapshot);
    },
    onError: (error) => {
      console.error("status poll failed", error);
    },
  });

  const refresh = (): Promise<void> => poller.pollNow();

  const applyQueueChange = async (task: () => Promise<void>): Promise<void> => {
    try {
      await task();
      notice = null;
      await refresh();
    } catch (error) {
      if (error instanceof TickInProgressError) {
        notice = error.message;
        draw();
        setTimeout(() => {
          void refresh();
        }, 5000);
      }
      throw error;
    }
  };

  draw = (snapshot: Partial<StatusSnapshot> = {}): void => {
    latest = { ...latest, ...snapshot };
    render(
      <App
        {...(notice ? { notice } : {})}
        {...(latest.world ? { world: latest.world } : {})}
        {...(latest.player ? { player: latest.player } : {})}
        {...(latest.orders ? { orders: latest.orders } : {})}
        {...(latest.offers ? { offers: latest.offers } : {})}
        {...(latest.inventory ? { inventory: latest.inventory } : {})}
        {...(latest.plot ? { plot: latest.plot } : {})}
        onAddOrder={(draft: OrderDraft) =>
          applyQueueChange(async () => {
            await addOrder("", "w1", playerId, draft);
          })
        }
        onRemoveOrder={(orderId: string) =>
          applyQueueChange(async () => {
            await removeOrder("", "w1", playerId, orderId);
          })
        }
        onReorderOrders={(orderIds: string[]) =>
          applyQueueChange(async () => {
            await reorderOrders("", "w1", playerId, orderIds);
          })
        }
        mapView={mapView}
      />,
      target,
    );
  };

  draw();
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
