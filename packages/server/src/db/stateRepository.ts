/**
 * Full world-state persistence for tick resolution (spec §14; M4.A05).
 *
 * Resolution loads one consistent snapshot inside the caller's `BEGIN
 * IMMEDIATE` transaction, mutates it in memory, then writes the result back
 * before the transaction commits. Every table is replaced from the snapshot, so
 * a rollback restores the previous tick exactly.
 */

import {
  type Animal,
  type Building,
  type Contribution,
  type CraftJob,
  type Crop,
  type Decoration,
  type Goal,
  type Goodwill,
  type InventoryRow,
  type Offer,
  type Order,
  type OrderLock,
  type Player,
  type ReadyEntry,
  type WildClaim,
  type WorldState,
} from "@bartervillage/rules";

import type { Database } from "./database.js";
import { loadPlots, loadRegions, loadTiles, loadWildNodes } from "./mapRepository.js";
import { loadWorld } from "./worldRepository.js";

type PlayerRow = {
  id: string;
  name: string;
  plot_id: string;
  joined_tick: number;
  energy: number;
  default_harvest: number;
  default_water: number;
  default_feed: number;
  default_tend: number;
};

type BuildingRow = {
  id: string;
  plot_id: string;
  type: string;
  level: number;
  construction_kind: Building["constructionKind"];
  construction_complete_tick: number | null;
};

type CraftJobRow = {
  building_id: string;
  recipe_id: string;
  started_tick: number;
  completes_tick: number;
  inputs_json: string;
  outputs_json: string;
};

type CropRow = {
  id: string;
  plot_id: string;
  tile_x: number;
  tile_y: number;
  type: string;
  planted_tick: number;
  growth_ticks: number;
  watered: number;
  tended: number;
  failed: number;
};

type AnimalRow = {
  id: string;
  plot_id: string;
  type: string;
  count: number;
  fed: number;
};

type InventoryRowShape = {
  plot_id: string;
  item: string;
  quantity: number;
  locked: number;
};

type OrderRow = {
  id: string;
  player_id: string;
  tick: number;
  sequence: number;
  type: Order["type"];
  payload_json: string;
  status: Order["status"];
  failure_reason: string | null;
};

type OrderLockRow = {
  order_id: string;
  plot_id: string;
  items_json: string;
};

type ReadyRow = {
  player_id: string;
  tick: number;
  position: number;
};

type OfferRow = {
  id: string;
  poster_id: string;
  kind: Offer["kind"];
  gives_json: string;
  wants_json: string;
  quantity: number;
  created_at_tick: number;
  expiry_tick: number;
  status: Offer["status"];
  parent_offer_id: string | null;
};

type WildClaimRow = {
  player_id: string;
  node_id: string;
  tick: number;
  sequence: number;
};

type GoalRow = {
  id: string;
  kind: Goal["kind"];
  title: string;
  requires_json: string;
  rewards_json: string;
  created_at_tick: number;
  deadline_tick: number;
  status: Goal["status"];
};

type ContributionRow = {
  id: string;
  goal_id: string;
  player_id: string;
  order_id: string;
  items_json: string;
  status: Contribution["status"];
};

type GoodwillRow = {
  player_id: string;
  score: number;
};

type DecorationRow = {
  id: string;
  plot_id: string;
  type: string;
  tile_x: number;
  tile_y: number;
};

type UnlockRow = {
  id: string;
};

function loadPlayers(db: Database): Player[] {
  return db
    .all<PlayerRow>(
      `SELECT id, name, plot_id, joined_tick, energy, default_harvest, default_water,
              default_feed, default_tend
       FROM players ORDER BY id`,
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      plotId: row.plot_id,
      joinedTick: row.joined_tick,
      energy: row.energy,
      defaults: {
        harvest: row.default_harvest !== 0,
        water: row.default_water !== 0,
        feed: row.default_feed !== 0,
        tend: row.default_tend !== 0,
      },
    }));
}

function loadBuildings(db: Database): Building[] {
  const jobsByBuilding = new Map<string, CraftJob[]>();
  for (const row of db.all<CraftJobRow>(
    `SELECT building_id, recipe_id, started_tick, completes_tick, inputs_json, outputs_json
     FROM craft_jobs ORDER BY building_id, position`,
  )) {
    const jobs = jobsByBuilding.get(row.building_id) ?? [];
    jobs.push({
      recipeId: row.recipe_id,
      startedTick: row.started_tick,
      completesTick: row.completes_tick,
      inputs: JSON.parse(row.inputs_json),
      outputs: JSON.parse(row.outputs_json),
    });
    jobsByBuilding.set(row.building_id, jobs);
  }

  return db
    .all<BuildingRow>(
      `SELECT id, plot_id, type, level, construction_kind, construction_complete_tick
       FROM buildings ORDER BY plot_id, id`,
    )
    .map((row) => ({
      id: row.id,
      plotId: row.plot_id,
      type: row.type,
      level: row.level,
      constructionKind: row.construction_kind,
      constructionCompleteTick: row.construction_complete_tick,
      craftQueue: jobsByBuilding.get(row.id) ?? [],
    }));
}

function loadCrops(db: Database): Crop[] {
  return db
    .all<CropRow>(
      `SELECT id, plot_id, tile_x, tile_y, type, planted_tick, growth_ticks, watered, tended,
              failed
       FROM crops ORDER BY plot_id, tile_y, tile_x`,
    )
    .map((row) => ({
      id: row.id,
      plotId: row.plot_id,
      tileX: row.tile_x,
      tileY: row.tile_y,
      type: row.type,
      plantedTick: row.planted_tick,
      growthTicks: row.growth_ticks,
      watered: row.watered !== 0,
      tended: row.tended !== 0,
      failed: row.failed !== 0,
    }));
}

function loadAnimals(db: Database): Animal[] {
  return db
    .all<AnimalRow>("SELECT id, plot_id, type, count, fed FROM animals ORDER BY plot_id, id")
    .map((row) => ({
      id: row.id,
      plotId: row.plot_id,
      type: row.type,
      count: row.count,
      fed: row.fed !== 0,
    }));
}

function loadInventory(db: Database): InventoryRow[] {
  return db
    .all<InventoryRowShape>(
      "SELECT plot_id, item, quantity, locked FROM inventory ORDER BY plot_id, item",
    )
    .map((row) => ({
      plotId: row.plot_id,
      item: row.item,
      quantity: row.quantity,
      locked: row.locked,
    }));
}

function loadOrders(db: Database): Order[] {
  return db
    .all<OrderRow>(
      `SELECT id, player_id, tick, sequence, type, payload_json, status, failure_reason
       FROM orders ORDER BY tick, sequence, id`,
    )
    .map(
      (row) =>
        ({
          id: row.id,
          playerId: row.player_id,
          tick: row.tick,
          sequence: row.sequence,
          type: row.type,
          payload: JSON.parse(row.payload_json),
          status: row.status,
          failureReason: row.failure_reason,
        }) as Order,
    );
}

function loadOrderLocks(db: Database): OrderLock[] {
  return db
    .all<OrderLockRow>("SELECT order_id, plot_id, items_json FROM order_locks ORDER BY order_id")
    .map((row) => ({
      orderId: row.order_id,
      plotId: row.plot_id,
      items: JSON.parse(row.items_json),
    }));
}

function loadReady(db: Database): ReadyEntry[] {
  return db
    .all<ReadyRow>("SELECT player_id, tick, position FROM ready ORDER BY tick, position")
    .map((row) => ({ playerId: row.player_id, tick: row.tick, position: row.position }));
}

function loadOffers(db: Database): Offer[] {
  return db
    .all<OfferRow>(
      `SELECT id, poster_id, kind, gives_json, wants_json, quantity, created_at_tick,
              expiry_tick, status, parent_offer_id
       FROM offers ORDER BY created_at_tick, id`,
    )
    .map((row) => ({
      id: row.id,
      posterId: row.poster_id,
      kind: row.kind,
      gives: JSON.parse(row.gives_json),
      wants: JSON.parse(row.wants_json),
      quantity: row.quantity,
      createdAtTick: row.created_at_tick,
      expiryTick: row.expiry_tick,
      status: row.status,
      parentOfferId: row.parent_offer_id,
    }));
}

function loadClaims(db: Database): WildClaim[] {
  return db
    .all<WildClaimRow>(
      "SELECT player_id, node_id, tick, sequence FROM wild_claims ORDER BY tick, sequence",
    )
    .map((row) => ({
      playerId: row.player_id,
      nodeId: row.node_id,
      tick: row.tick,
      sequence: row.sequence,
    }));
}

function loadGoals(db: Database): Goal[] {
  return db
    .all<GoalRow>(
      `SELECT id, kind, title, requires_json, rewards_json, created_at_tick, deadline_tick,
              status
       FROM goals ORDER BY created_at_tick, id`,
    )
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      requires: JSON.parse(row.requires_json),
      rewards: JSON.parse(row.rewards_json),
      createdAtTick: row.created_at_tick,
      deadlineTick: row.deadline_tick,
      status: row.status,
    }));
}

function loadContributions(db: Database): Contribution[] {
  return db
    .all<ContributionRow>(
      "SELECT id, goal_id, player_id, order_id, items_json, status FROM contributions ORDER BY id",
    )
    .map((row) => ({
      id: row.id,
      goalId: row.goal_id,
      playerId: row.player_id,
      orderId: row.order_id,
      items: JSON.parse(row.items_json),
      status: row.status,
    }));
}

function loadGoodwill(db: Database): Goodwill[] {
  return db
    .all<GoodwillRow>("SELECT player_id, score FROM goodwill ORDER BY player_id")
    .map((row) => ({ playerId: row.player_id, score: row.score }));
}

function loadDecorations(db: Database): Decoration[] {
  return db
    .all<DecorationRow>(
      "SELECT id, plot_id, type, tile_x, tile_y FROM decorations ORDER BY plot_id, tile_y, tile_x",
    )
    .map((row) => ({
      id: row.id,
      plotId: row.plot_id,
      type: row.type,
      tileX: row.tile_x,
      tileY: row.tile_y,
    }));
}

function loadUnlocks(db: Database, table: string, column: string, worldId: string): string[] {
  return db
    .all<UnlockRow>(
      `SELECT ${column} AS id FROM ${table} WHERE world_id = ? ORDER BY ${column}`,
      worldId,
    )
    .map((row) => row.id);
}

export function loadWorldState(db: Database, worldId: string): WorldState | undefined {
  const world = loadWorld(db, worldId);
  if (!world) {
    return undefined;
  }
  const orders = loadOrders(db);
  return {
    world,
    players: loadPlayers(db),
    regions: loadRegions(db),
    tiles: loadTiles(db),
    plots: loadPlots(db),
    buildings: loadBuildings(db),
    crops: loadCrops(db),
    animals: loadAnimals(db),
    inventory: loadInventory(db),
    orders,
    orderLocks: loadOrderLocks(db),
    ready: loadReady(db),
    offers: loadOffers(db),
    wildNodes: loadWildNodes(db),
    claims: loadClaims(db),
    goals: loadGoals(db),
    contributions: loadContributions(db),
    goodwill: loadGoodwill(db),
    decorations: loadDecorations(db),
    nextOrderSequence: orders.reduce((next, order) => Math.max(next, order.sequence + 1), 1),
    unlockedRecipes: loadUnlocks(db, "unlocked_recipes", "recipe_id", worldId),
    unlockedCrops: loadUnlocks(db, "unlocked_crops", "crop_id", worldId),
    unlockedBuildings: loadUnlocks(db, "unlocked_buildings", "building_id", worldId),
    unlockedRegions: loadUnlocks(db, "unlocked_regions", "region_id", worldId),
    unlockedNodes: loadUnlocks(db, "unlocked_nodes", "node_id", worldId),
  };
}

function saveWorld(db: Database, state: WorldState): void {
  db.run(
    "UPDATE worlds SET current_tick = ?, season = ?, weather = ?, next_deadline = ? WHERE id = ?",
    state.world.currentTick,
    state.world.season,
    state.world.weather,
    state.world.nextDeadline,
    state.world.id,
  );
}

function savePlayers(db: Database, state: WorldState): void {
  for (const player of state.players) {
    db.run(
      `INSERT INTO players
         (id, name, plot_id, joined_tick, energy, default_harvest, default_water, default_feed,
          default_tend)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         plot_id = excluded.plot_id,
         joined_tick = excluded.joined_tick,
         energy = excluded.energy,
         default_harvest = excluded.default_harvest,
         default_water = excluded.default_water,
         default_feed = excluded.default_feed,
         default_tend = excluded.default_tend`,
      player.id,
      player.name,
      player.plotId,
      player.joinedTick,
      player.energy,
      player.defaults.harvest ? 1 : 0,
      player.defaults.water ? 1 : 0,
      player.defaults.feed ? 1 : 0,
      player.defaults.tend ? 1 : 0,
    );
  }
}

function savePlots(db: Database, state: WorldState): void {
  for (const plot of state.plots) {
    db.run(
      "UPDATE plots SET player_id = ?, world_owned = ? WHERE id = ?",
      plot.playerId,
      plot.worldOwned ? 1 : 0,
      plot.id,
    );
  }
}

function saveWildNodes(db: Database, state: WorldState): void {
  for (const node of state.wildNodes) {
    db.run(
      "UPDATE wild_nodes SET amount = ?, capacity = ?, regrow_rate = ? WHERE id = ?",
      node.amount,
      node.capacity,
      node.regrowRate,
      node.id,
    );
  }
}

function saveBuildings(db: Database, state: WorldState): void {
  db.run("DELETE FROM craft_jobs");
  db.run("DELETE FROM buildings");
  for (const building of state.buildings) {
    db.run(
      `INSERT INTO buildings
         (id, plot_id, type, level, construction_kind, construction_complete_tick)
       VALUES (?, ?, ?, ?, ?, ?)`,
      building.id,
      building.plotId,
      building.type,
      building.level,
      building.constructionKind,
      building.constructionCompleteTick,
    );
    building.craftQueue.forEach((job, position) => {
      db.run(
        `INSERT INTO craft_jobs
           (building_id, position, recipe_id, started_tick, completes_tick, inputs_json,
            outputs_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        building.id,
        position,
        job.recipeId,
        job.startedTick,
        job.completesTick,
        JSON.stringify(job.inputs),
        JSON.stringify(job.outputs),
      );
    });
  }
}

function saveCrops(db: Database, state: WorldState): void {
  db.run("DELETE FROM crops");
  for (const crop of state.crops) {
    db.run(
      `INSERT INTO crops
         (id, plot_id, tile_x, tile_y, type, planted_tick, growth_ticks, watered, tended, failed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crop.id,
      crop.plotId,
      crop.tileX,
      crop.tileY,
      crop.type,
      crop.plantedTick,
      crop.growthTicks,
      crop.watered ? 1 : 0,
      crop.tended ? 1 : 0,
      crop.failed ? 1 : 0,
    );
  }
}

function saveAnimals(db: Database, state: WorldState): void {
  db.run("DELETE FROM animals");
  for (const animal of state.animals) {
    db.run(
      "INSERT INTO animals (id, plot_id, type, count, fed) VALUES (?, ?, ?, ?, ?)",
      animal.id,
      animal.plotId,
      animal.type,
      animal.count,
      animal.fed ? 1 : 0,
    );
  }
}

function saveInventory(db: Database, state: WorldState): void {
  db.run("DELETE FROM inventory");
  for (const row of state.inventory) {
    db.run(
      "INSERT INTO inventory (plot_id, item, quantity, locked) VALUES (?, ?, ?, ?)",
      row.plotId,
      row.item,
      row.quantity,
      row.locked,
    );
  }
}

function saveOrders(db: Database, state: WorldState): void {
  db.run("DELETE FROM order_locks");
  db.run("DELETE FROM orders");
  for (const order of state.orders) {
    db.run(
      `INSERT INTO orders
         (id, player_id, tick, sequence, type, payload_json, status, failure_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      order.id,
      order.playerId,
      order.tick,
      order.sequence,
      order.type,
      JSON.stringify(order.payload),
      order.status,
      order.failureReason,
    );
  }
  for (const lock of state.orderLocks) {
    db.run(
      "INSERT INTO order_locks (order_id, plot_id, items_json) VALUES (?, ?, ?)",
      lock.orderId,
      lock.plotId,
      JSON.stringify(lock.items),
    );
  }
}

function saveReady(db: Database, state: WorldState): void {
  db.run("DELETE FROM ready");
  for (const entry of state.ready) {
    db.run(
      "INSERT INTO ready (player_id, tick, position) VALUES (?, ?, ?)",
      entry.playerId,
      entry.tick,
      entry.position,
    );
  }
}

/**
 * Insert offers parent-first so the self-referencing foreign key never sees a
 * counter-offer before its parent.
 */
function saveOffers(db: Database, state: WorldState): void {
  db.run("DELETE FROM offers");
  const remaining = [...state.offers];
  const inserted = new Set<string>();
  while (remaining.length > 0) {
    const index = remaining.findIndex(
      (offer) => offer.parentOfferId === null || inserted.has(offer.parentOfferId),
    );
    if (index === -1) {
      throw new Error("Offer parent cycle detected while saving world state");
    }
    const offer = remaining[index];
    if (!offer) {
      throw new Error("Offer disappeared while saving world state");
    }
    remaining.splice(index, 1);
    db.run(
      `INSERT INTO offers
         (id, poster_id, kind, gives_json, wants_json, quantity, created_at_tick, expiry_tick,
          status, parent_offer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      offer.id,
      offer.posterId,
      offer.kind,
      JSON.stringify(offer.gives),
      JSON.stringify(offer.wants),
      offer.quantity,
      offer.createdAtTick,
      offer.expiryTick,
      offer.status,
      offer.parentOfferId,
    );
    inserted.add(offer.id);
  }
}

function saveClaims(db: Database, state: WorldState): void {
  db.run("DELETE FROM wild_claims");
  for (const claim of state.claims) {
    db.run(
      "INSERT INTO wild_claims (player_id, node_id, tick, sequence) VALUES (?, ?, ?, ?)",
      claim.playerId,
      claim.nodeId,
      claim.tick,
      claim.sequence,
    );
  }
}

function saveGoals(db: Database, state: WorldState): void {
  db.run("DELETE FROM contributions");
  db.run("DELETE FROM goals");
  for (const goal of state.goals) {
    db.run(
      `INSERT INTO goals
         (id, kind, title, requires_json, rewards_json, created_at_tick, deadline_tick, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      goal.id,
      goal.kind,
      goal.title,
      JSON.stringify(goal.requires),
      JSON.stringify(goal.rewards),
      goal.createdAtTick,
      goal.deadlineTick,
      goal.status,
    );
  }
  for (const contribution of state.contributions) {
    db.run(
      `INSERT INTO contributions
         (id, goal_id, player_id, order_id, items_json, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      contribution.id,
      contribution.goalId,
      contribution.playerId,
      contribution.orderId,
      JSON.stringify(contribution.items),
      contribution.status,
    );
  }
}

function saveGoodwill(db: Database, state: WorldState): void {
  db.run("DELETE FROM goodwill");
  for (const entry of state.goodwill) {
    db.run("INSERT INTO goodwill (player_id, score) VALUES (?, ?)", entry.playerId, entry.score);
  }
}

function saveDecorations(db: Database, state: WorldState): void {
  db.run("DELETE FROM decorations");
  for (const decoration of state.decorations) {
    db.run(
      "INSERT INTO decorations (id, plot_id, type, tile_x, tile_y) VALUES (?, ?, ?, ?, ?)",
      decoration.id,
      decoration.plotId,
      decoration.type,
      decoration.tileX,
      decoration.tileY,
    );
  }
}

function saveUnlocks(
  db: Database,
  table: string,
  column: string,
  worldId: string,
  values: readonly string[],
): void {
  db.run(`DELETE FROM ${table} WHERE world_id = ?`, worldId);
  for (const value of values) {
    db.run(`INSERT INTO ${table} (world_id, ${column}) VALUES (?, ?)`, worldId, value);
  }
}

export function saveWorldState(db: Database, state: WorldState): void {
  saveWorld(db, state);
  savePlayers(db, state);
  savePlots(db, state);
  saveWildNodes(db, state);
  saveBuildings(db, state);
  saveCrops(db, state);
  saveAnimals(db, state);
  saveInventory(db, state);
  saveOrders(db, state);
  saveReady(db, state);
  saveOffers(db, state);
  saveClaims(db, state);
  saveGoals(db, state);
  saveGoodwill(db, state);
  saveDecorations(db, state);
  saveUnlocks(db, "unlocked_recipes", "recipe_id", state.world.id, state.unlockedRecipes);
  saveUnlocks(db, "unlocked_crops", "crop_id", state.world.id, state.unlockedCrops);
  saveUnlocks(db, "unlocked_buildings", "building_id", state.world.id, state.unlockedBuildings);
  saveUnlocks(db, "unlocked_regions", "region_id", state.world.id, state.unlockedRegions);
  saveUnlocks(db, "unlocked_nodes", "node_id", state.world.id, state.unlockedNodes);
}
