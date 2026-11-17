/**
 * Plot view (M5.B01).
 *
 * Shows the home, field and storehouse alongside the plot's crops, animals and
 * storage. Placeholder geometry stands in for final art until M8.10.
 */

import { useState } from "preact/hooks";

import {
  availableHelpChores,
  HELP_CHORES,
  HELP_ENERGY_COST,
  HELP_GOODWILL,
  HELP_LABELS,
  type HelpChore,
} from "./help.js";
import type { PlotBuilding, PlotCrop, PlotSnapshot } from "./plot.js";

export interface PlotViewProps {
  plot: PlotSnapshot;
  /** Others' plots are read-only except for the help actions (M5.A08, M6.09). */
  readOnly?: boolean;
  /** Queue a help order for one chore on this plot (M6.09). */
  onHelp?: ((chore: HelpChore) => void | Promise<void>) | undefined;
  /** The helper's current energy, used for a light affordability check. */
  helperEnergy?: number | undefined;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function HelpSection({
  plot,
  helperEnergy,
  onHelp,
}: {
  plot: PlotSnapshot;
  helperEnergy?: number | undefined;
  onHelp: (chore: HelpChore) => void | Promise<void>;
}) {
  const [pending, setPending] = useState<HelpChore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const available = availableHelpChores(plot);
  const canAfford = helperEnergy === undefined || helperEnergy >= HELP_ENERGY_COST;

  const perform = (chore: HelpChore): void => {
    setPending(chore);
    setError(null);
    void Promise.resolve(onHelp(chore))
      .catch((caught) => setError(errorMessage(caught)))
      .finally(() => setPending(null));
  };

  return (
    <section class="plot-help" aria-label="Help this plot">
      <h3 class="plot-section-title">Help out</h3>
      <p class="plot-help-hint">
        Each chore costs {HELP_ENERGY_COST} energy and earns +{HELP_GOODWILL} goodwill. The host
        gets the benefit.
      </p>
      {available.length === 0 ? (
        <p class="empty-state">This plot needs no help right now.</p>
      ) : null}
      {!canAfford ? (
        <p class="plot-help-error">You need {HELP_ENERGY_COST} energy to help.</p>
      ) : null}
      <div class="plot-help-actions">
        {HELP_CHORES.map((chore) => (
          <button
            key={chore}
            type="button"
            class="plot-help-action"
            data-chore={chore}
            disabled={pending !== null || !canAfford || !available.includes(chore)}
            onClick={() => perform(chore)}
          >
            {pending === chore ? "Queuing…" : HELP_LABELS[chore]}
          </button>
        ))}
      </div>
      {error ? <p class="plot-help-error">{error}</p> : null}
    </section>
  );
}

export function PlotView({ plot, readOnly = false, onHelp, helperEnergy }: PlotViewProps) {
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

      {readOnly && onHelp ? (
        <HelpSection plot={plot} helperEnergy={helperEnergy} onHelp={onHelp} />
      ) : null}

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
