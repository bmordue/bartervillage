/**
 * Player and starter-plot persistence (spec §5, §6.1; M3.09, M3.10).
 */

import type { Database } from "./database.js";
import { claimPlot } from "./mapRepository.js";

export const STARTER_BUILDINGS = ["home", "field", "storehouse"] as const;

export function provisionStarterBuildings(db: Database, plotId: string): void {
  for (const type of STARTER_BUILDINGS) {
    db.run(
      `INSERT INTO buildings (id, plot_id, type, level, construction_kind, construction_complete_tick)
       VALUES (?, ?, ?, 1, NULL, NULL) ON CONFLICT(id) DO NOTHING`,
      `${plotId}:${type}`,
      plotId,
      type,
    );
  }
}

/** Claim a site and give the new plot its home, field and storehouse. */
export function claimSite(db: Database, playerId: string, plotId: string): boolean {
  return db.transaction(() => {
    if (!claimPlot(db, playerId, plotId)) {
      return false;
    }
    provisionStarterBuildings(db, plotId);
    return true;
  });
}
