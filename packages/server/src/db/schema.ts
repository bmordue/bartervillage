/**
 * SQLite schema and migrations (spec §13; M3.01).
 *
 * Plain raw SQL, no ORM. Every migration is append-only: never edit a released
 * migration, add a new one.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE worlds (
  id TEXT PRIMARY KEY,
  seed TEXT NOT NULL,
  generator_version TEXT NOT NULL,
  content_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  deadline_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  min_tick_gap_minutes INTEGER NOT NULL,
  player_cap INTEGER NOT NULL,
  current_tick INTEGER NOT NULL DEFAULT 0,
  season TEXT NOT NULL,
  weather TEXT NOT NULL,
  next_deadline TEXT,
  resolving_owner TEXT,
  resolving_acquired_at TEXT,
  resolving_expires_at TEXT
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  plot_id TEXT NOT NULL UNIQUE,
  joined_tick INTEGER NOT NULL,
  energy INTEGER NOT NULL,
  default_harvest INTEGER NOT NULL DEFAULT 1,
  default_water INTEGER NOT NULL DEFAULT 1,
  default_feed INTEGER NOT NULL DEFAULT 1,
  default_tend INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  kind TEXT NOT NULL CHECK (kind IN ('passkey', 'discord', 'github')),
  subject TEXT NOT NULL,
  secret_ciphertext TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (kind, subject)
);
CREATE INDEX credentials_player ON credentials(player_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_player ON sessions(player_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  created_by_player_id TEXT REFERENCES players(id),
  redeemed_by_player_id TEXT REFERENCES players(id),
  created_at TEXT NOT NULL,
  redeemed_at TEXT
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (player_id, endpoint)
);

CREATE TABLE regions (
  id TEXT PRIMARY KEY,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  UNIQUE (x, y)
);

CREATE TABLE tiles (
  id TEXT PRIMARY KEY,
  region_id TEXT NOT NULL REFERENCES regions(id),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('plot', 'commons', 'wild', 'water', 'blocked')),
  biome TEXT NOT NULL,
  soil INTEGER NOT NULL,
  water INTEGER NOT NULL,
  light INTEGER NOT NULL,
  UNIQUE (region_id, x, y)
);
CREATE INDEX tiles_region ON tiles(region_id);

CREATE TABLE plots (
  id TEXT PRIMARY KEY,
  player_id TEXT UNIQUE REFERENCES players(id),
  region_id TEXT NOT NULL REFERENCES regions(id),
  site_x INTEGER NOT NULL,
  site_y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  world_owned INTEGER NOT NULL DEFAULT 0,
  UNIQUE (region_id, site_x, site_y)
);
CREATE INDEX plots_region ON plots(region_id);

CREATE TABLE buildings (
  id TEXT PRIMARY KEY,
  plot_id TEXT NOT NULL REFERENCES plots(id),
  type TEXT NOT NULL,
  level INTEGER NOT NULL,
  construction_kind TEXT CHECK (construction_kind IN ('build', 'upgrade')),
  construction_complete_tick INTEGER,
  UNIQUE (plot_id, type)
);
CREATE INDEX buildings_plot ON buildings(plot_id);

CREATE TABLE craft_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id TEXT NOT NULL REFERENCES buildings(id),
  position INTEGER NOT NULL,
  recipe_id TEXT NOT NULL,
  started_tick INTEGER NOT NULL,
  completes_tick INTEGER NOT NULL,
  inputs_json TEXT NOT NULL,
  outputs_json TEXT NOT NULL,
  UNIQUE (building_id, position)
);
CREATE INDEX craft_jobs_building ON craft_jobs(building_id, position);

CREATE TABLE crops (
  id TEXT PRIMARY KEY,
  plot_id TEXT NOT NULL REFERENCES plots(id),
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  type TEXT NOT NULL,
  planted_tick INTEGER NOT NULL,
  growth_ticks INTEGER NOT NULL,
  watered INTEGER NOT NULL DEFAULT 0,
  tended INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (plot_id, tile_x, tile_y)
);
CREATE INDEX crops_plot ON crops(plot_id);

CREATE TABLE animals (
  id TEXT PRIMARY KEY,
  plot_id TEXT NOT NULL REFERENCES plots(id),
  type TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  fed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (plot_id, type)
);
CREATE INDEX animals_plot ON animals(plot_id);

CREATE TABLE inventory (
  plot_id TEXT NOT NULL REFERENCES plots(id),
  item TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (plot_id, item),
  CHECK (quantity >= 0),
  CHECK (locked >= 0),
  CHECK (locked <= quantity)
);
CREATE INDEX inventory_item ON inventory(item);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  tick INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  failure_reason TEXT,
  UNIQUE (player_id, tick, sequence)
);
CREATE INDEX orders_player_tick ON orders(player_id, tick, sequence);

CREATE TABLE ready (
  player_id TEXT NOT NULL REFERENCES players(id),
  tick INTEGER NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (player_id, tick),
  UNIQUE (tick, position)
);

CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  poster_id TEXT NOT NULL REFERENCES players(id),
  kind TEXT NOT NULL CHECK (kind IN ('offer', 'wanted_request', 'counter_offer')),
  gives_json TEXT NOT NULL,
  wants_json TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at_tick INTEGER NOT NULL,
  expiry_tick INTEGER NOT NULL,
  status TEXT NOT NULL,
  parent_offer_id TEXT REFERENCES offers(id),
  CHECK (expiry_tick > created_at_tick)
);
CREATE INDEX offers_status_expiry ON offers(status, expiry_tick);
CREATE INDEX offers_poster ON offers(poster_id);
CREATE INDEX offers_parent ON offers(parent_offer_id);

CREATE TABLE wild_nodes (
  id TEXT PRIMARY KEY,
  region_id TEXT NOT NULL REFERENCES regions(id),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  resource TEXT NOT NULL,
  amount INTEGER NOT NULL,
  capacity INTEGER NOT NULL,
  regrow_rate INTEGER NOT NULL,
  UNIQUE (region_id, x, y),
  CHECK (amount >= 0),
  CHECK (capacity >= 0),
  CHECK (amount <= capacity),
  CHECK (regrow_rate >= 0)
);
CREATE INDEX wild_nodes_region ON wild_nodes(region_id);

CREATE TABLE wild_claims (
  player_id TEXT NOT NULL REFERENCES players(id),
  node_id TEXT NOT NULL REFERENCES wild_nodes(id),
  tick INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  PRIMARY KEY (player_id, node_id, tick)
);
CREATE INDEX wild_claims_tick ON wild_claims(tick);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  requires_json TEXT NOT NULL,
  rewards_json TEXT NOT NULL,
  created_at_tick INTEGER NOT NULL,
  deadline_tick INTEGER NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX goals_status ON goals(status, deadline_tick);

CREATE TABLE contributions (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  order_id TEXT NOT NULL,
  items_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('locked', 'consumed', 'released'))
);
CREATE INDEX contributions_goal ON contributions(goal_id, status);

CREATE TABLE goodwill (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  score INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE decorations (
  id TEXT PRIMARY KEY,
  plot_id TEXT NOT NULL REFERENCES plots(id),
  type TEXT NOT NULL,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  UNIQUE (plot_id, tile_x, tile_y)
);

CREATE TABLE unlocked_recipes (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  recipe_id TEXT NOT NULL,
  PRIMARY KEY (world_id, recipe_id)
);

CREATE TABLE unlocked_crops (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  crop_id TEXT NOT NULL,
  PRIMARY KEY (world_id, crop_id)
);

CREATE TABLE unlocked_buildings (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  building_id TEXT NOT NULL,
  PRIMARY KEY (world_id, building_id)
);

CREATE TABLE unlocked_regions (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  region_id TEXT NOT NULL,
  PRIMARY KEY (world_id, region_id)
);

CREATE TABLE unlocked_nodes (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  node_id TEXT NOT NULL,
  PRIMARY KEY (world_id, node_id)
);

CREATE TABLE tick_logs (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  tick INTEGER NOT NULL,
  header_json TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  PRIMARY KEY (world_id, tick)
);

CREATE TABLE archived_events (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  tick INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  version INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (world_id, tick, sequence)
);
CREATE INDEX archived_events_tick ON archived_events(world_id, tick);

CREATE TABLE avatar_paths (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  tick INTEGER NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  path_json TEXT NOT NULL,
  returned_home INTEGER NOT NULL,
  PRIMARY KEY (world_id, tick, player_id)
);
`;

const LOCKS_MIGRATION = `
CREATE TABLE order_locks (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  plot_id TEXT NOT NULL,
  items_json TEXT NOT NULL
);
CREATE INDEX order_locks_order ON order_locks(order_id);
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "initial_schema", sql: INITIAL_SCHEMA },
  { version: 2, name: "order_locks", sql: LOCKS_MIGRATION },
];
