/**
 * Plot view (M5.B01).
 *
 * Shows the home, field and storehouse alongside the plot's crops, animals and
 * storage. Placeholder geometry stands in for final art until M8.10.
 */

import type { PlotBuilding, PlotCrop, PlotSnapshot } from "./plot.js";

export interface PlotViewProps {
  plot: PlotSnapshot;
  /** Others' plots are read-only (M5.A08). */
  readOnly?: boolean;
}

function humanize(value: string): string {
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const CORE_BUILDINGS = ["home", "field", "storehouse"] as const;

function buildingStatus(building: PlotBuilding): string {
  if (building.constructionKind) {
    const at =
      building.constructionCompleteTick === null
        ? ""
        : ` (done tick ${building.constructionCompleteTick})`;
    return `${humanize(building.constructionKind)} in progress${at}`;
  }
  return `Level ${building.level}`;
}

function sortBuildings(buildings: PlotBuilding[]): PlotBuilding[] {
  const coreOrder = new Map<string, number>(CORE_BUILDINGS.map((type, index) => [type, index]));
  return [...buildings].sort((a, b) => {
    const aRank = coreOrder.get(a.type) ?? CORE_BUILDINGS.length;
    const bRank = coreOrder.get(b.type) ?? CORE_BUILDINGS.length;
    return aRank - bRank || a.type.localeCompare(b.type);
  });
}

function cropStatus(crop: PlotCrop): string {
  if (crop.failed) {
    return "failed";
  }
  if (!crop.watered || !crop.tended) {
    const missing = [!crop.watered ? "water" : null, !crop.tended ? "tend" : null].filter(
      (value): value is string => value !== null,
    );
    return `needs ${missing.join(" and ")}`;
  }
  return "growing";
}

export function PlotView({ plot, readOnly = false }: PlotViewProps) {
  const buildings = sortBuildings(plot.buildings);
  const cropsByTile = new Map(plot.crops.map((crop) => [`${crop.tileX},${crop.tileY}`, crop]));
  const cells = Array.from({ length: plot.plot.width * plot.plot.height }, (_, index) => {
    const x = index % plot.plot.width;
    const y = Math.floor(index / plot.plot.width);
    return { x, y, crop: cropsByTile.get(`${x},${y}`) };
  });
  const capacity = plot.storage.capacity;
  const fill = capacity > 0 ? Math.min(1, plot.storage.used / capacity) : 0;

  return (
    <section class="plot-view" aria-label={readOnly ? "Plot (read-only)" : "Your plot"}>
      <header class="plot-header">
        <div>
          <h2 class="plot-title">
            {readOnly ? "Plot" : "Your plot"} · {plot.plot.id}
          </h2>
          <p class="plot-meta">
            Region {plot.plot.regionId} · site ({plot.plot.siteX}, {plot.plot.siteY}) ·{" "}
            {plot.plot.width}x{plot.plot.height} tiles
          </p>
        </div>
        {readOnly ? <span class="plot-badge">Read-only</span> : null}
      </header>

      <div class="plot-buildings">
        {buildings.length === 0 ? (
          <p class="empty-state">No buildings on this plot.</p>
        ) : (
          buildings.map((building) => (
            <article key={building.id} class="plot-building" data-building={building.type}>
              <h3 class="plot-building-name">{humanize(building.type)}</h3>
              <p class="plot-building-status">{buildingStatus(building)}</p>
            </article>
          ))
        )}
      </div>

      <div class="plot-grid-wrap">
        <div>
          <h3 class="plot-section-title">Field</h3>
          <div
            class="plot-grid"
            style={{
              gridTemplateColumns: `repeat(${plot.plot.width}, minmax(0, 1fr))`,
            }}
          >
            {cells.map((cell) => (
              <span
                key={`${cell.x},${cell.y}`}
                class={[
                  "plot-tile",
                  cell.crop ? "plot-tile-crop" : "",
                  cell.crop?.failed ? "plot-tile-failed" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={
                  cell.crop
                    ? `${humanize(cell.crop.type)} at (${cell.x}, ${cell.y}): ${cropStatus(
                        cell.crop,
                      )}`
                    : `Empty tile (${cell.x}, ${cell.y})`
                }
              />
            ))}
          </div>
        </div>

        <aside class="plot-side">
          <h3 class="plot-section-title">Storehouse</h3>
          <p class="plot-storage">
            {plot.storage.used} / {plot.storage.capacity} used · {plot.storage.free} free
          </p>
          <div class="plot-storage-bar" aria-hidden="true">
            <span class="plot-storage-fill" style={{ width: `${fill * 100}%` }} />
          </div>

          <h3 class="plot-section-title">Animals</h3>
          {plot.animals.length === 0 ? (
            <p class="empty-state">No animals.</p>
          ) : (
            <ul class="plot-animals">
              {plot.animals.map((animal) => (
                <li key={animal.id}>
                  {animal.count} {humanize(animal.type)}
                  <span class="plot-animal-status">{animal.fed ? "fed" : "hungry"}</span>
                </li>
              ))}
            </ul>
          )}

          <h3 class="plot-section-title">Growing crops</h3>
          {plot.crops.length === 0 ? (
            <p class="empty-state">Nothing planted.</p>
          ) : (
            <ul class="plot-crops">
              {plot.crops.map((crop) => (
                <li key={crop.id}>
                  {humanize(crop.type)} ({crop.tileX}, {crop.tileY})
                  <span class="plot-crop-status">{cropStatus(crop)}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
