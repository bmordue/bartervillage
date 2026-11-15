/**
 * Browser entry point for the Preact client (M5.A01).
 *
 * Mounts the application shell into the `#app` element and polls `GET /world`
 * every five seconds (M5.A05). Kept separate from the component tree so tests
 * can render `App` without a DOM.
 */

import { render } from "preact";
import { App } from "./app.js";
import { createWorldPoller } from "./world.js";

/** Mount the application shell into `root`, or `#app` when omitted. */
export function mountApp(root?: HTMLElement | null): void {
  const target = root ?? document.getElementById("app");
  if (!target) {
    throw new Error('Client mount point "#app" not found');
  }

  render(<App />, target);

  const poller = createWorldPoller({
    onData: (world) => {
      render(<App world={world} />, target);
    },
    onError: (error) => {
      console.error("world poll failed", error);
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
