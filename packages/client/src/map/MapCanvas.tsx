/**
 * Preact host for the PixiJS map (M5.A02).
 *
 * The renderer is created in an effect, so server-side rendering and unit tests
 * only produce the empty host element.
 */

import { useEffect, useRef } from "preact/hooks";

import type { MapView } from "./geometry.js";
import { createMapRenderer, type MapRenderer } from "./renderer.js";

export interface MapCanvasProps {
  view: MapView;
}

export function MapCanvas({ view }: MapCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<MapRenderer | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) {
      return;
    }

    let disposed = false;
    void createMapRenderer(element).then((created) => {
      if (disposed) {
        created.destroy();
        return;
      }
      renderer.current = created;
      created.render(view);
    });

    return () => {
      disposed = true;
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    renderer.current?.render(view);
  }, [view]);

  return <div class="map-canvas" data-testid="map-canvas" ref={host} />;
}
