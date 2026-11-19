/**
 * PixiJS map renderer (spec §11; M5.A02).
 *
 * Draws a `MapView` as 32x32 placeholder tiles and fits it to the viewport.
 * PixiJS is imported lazily so Node-based unit tests never initialise WebGL.
 */

import type { Application, Container, Graphics } from "pixi.js";

import type { MapView } from "./geometry.js";

export interface MapRenderer {
  readonly canvas: HTMLCanvasElement;
  /** Draw a view, scaled to fit the current canvas. */
  render: (view: MapView) => void;
  /** Redraw the last view after the container resizes. */
  resize: () => void;
  destroy: () => void;
}

export interface CreateMapRendererOptions {
  background?: number;
}

export async function createMapRenderer(
  container: HTMLElement,
  options: CreateMapRendererOptions = {},
): Promise<MapRenderer> {
  const { Application, Container: PixiContainer, Graphics: PixiGraphics } = await import("pixi.js");

  const app: Application = new Application();
  await app.init({
    resizeTo: container,
    background: options.background ?? 0xf4f1e8,
    antialias: false,
    preference: "webgl",
  });
  container.appendChild(app.canvas);

  const world: Container = new PixiContainer();
  app.stage.addChild(world);

  let lastView: MapView | undefined;

  const draw = (view: MapView): void => {
    lastView = view;

    for (const child of world.removeChildren()) {
      child.destroy();
    }

    const tiles: Graphics = new PixiGraphics();
    for (const rect of view.rects) {
      tiles.rect(rect.x, rect.y, rect.width, rect.height).fill(rect.color);
    }
    world.addChild(tiles);

    if (view.outlines.length > 0) {
      const outlines: Graphics = new PixiGraphics();
      for (const outline of view.outlines) {
        outlines
          .rect(outline.x, outline.y, outline.width, outline.height)
          .stroke({ width: outline.strokeWidth, color: outline.color, alignment: 0.5 });
      }
      world.addChild(outlines);
    }

    if (view.paths.length > 0) {
      const paths: Graphics = new PixiGraphics();
      for (const path of view.paths) {
        const [first, ...rest] = path.points;
        if (!first || rest.length === 0) {
          continue;
        }
        paths.moveTo(first.x, first.y);
        for (const point of rest) {
          paths.lineTo(point.x, point.y);
        }
        paths.stroke({ width: path.width, color: path.color, cap: "round", join: "round" });
      }
      world.addChild(paths);
    }

    if (view.markers.length > 0) {
      const markers: Graphics = new PixiGraphics();
      for (const marker of view.markers) {
        markers.circle(marker.x, marker.y, marker.radius).fill(marker.color);
      }
      world.addChild(markers);
    }

    const canvasWidth = container.clientWidth || view.width;
    const canvasHeight = container.clientHeight || view.height;
    app.renderer.resize(canvasWidth, canvasHeight);

    const focus = view.focus ?? {
      x: 0,
      y: 0,
      width: view.width,
      height: view.height,
    };
    const scale = Math.min(canvasWidth / focus.width, canvasHeight / focus.height);
    world.scale.set(scale);
    world.position.set(
      (canvasWidth - focus.width * scale) / 2 - focus.x * scale,
      (canvasHeight - focus.height * scale) / 2 - focus.y * scale,
    );
  };

  return {
    canvas: app.canvas,
    render: draw,
    resize: () => {
      if (lastView) {
        draw(lastView);
      }
    },
    destroy: () => {
      app.destroy(true, { children: true });
    },
  };
}
