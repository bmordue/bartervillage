/**
 * Placeholder map used until the server exposes tiles (M4.B02 follow-up) and the
 * final art packs land (M8.10). Regions are generated deterministically by the
 * shared rules package, so the preview matches a real region shape.
 */

import { content } from "@bartervillage/content";
import { generateRegion, MAP_GENERATOR_VERSION } from "@bartervillage/rules";

import { buildMapView, type MapView } from "./geometry.js";

export const PREVIEW_WORLD_SEED = "preview-seed";

export function createPreviewMapView(regionX = 0, regionY = 0): MapView {
  const generated = generateRegion(
    PREVIEW_WORLD_SEED,
    MAP_GENERATOR_VERSION,
    regionX,
    regionY,
    content,
  );
  return buildMapView({
    regions: [generated.region],
    tiles: generated.tiles,
    plots: generated.plots,
    wildNodes: generated.wildNodes,
  });
}
