/**
 * Shared domain types for Barter Village (spec §13).
 *
 * This module is pure data: it contains no I/O, no ambient time and no
 * randomness. Every persisted entity and every cross-package message is
 * described here so the rules, server, worker and client agree on the shape of
 * the world.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Brand-free opaque identifiers. IDs are strings so they survive JSON and SQLite. */
export type WorldId = string;
export type PlayerId = string;
export type RegionId = string;
export type TileId = string;
export type PlotId = string;
export type BuildingId = string;
export type CropId = string;
export type AnimalId = string;
export type OrderId = string;
export type OfferId = string;
export type NodeId = string;
export type GoalId = string;
export type ContributionId = string;
export type DecorationId = string;
export type CredentialId = string;
export type SessionId = string;
export type InviteId = string;
export type PushSubscriptionId = string;

export type ItemId = string;
export type CropTypeId = string;
export type AnimalTypeId = string;
export type BuildingTypeId = string;
export type RecipeId = string;
export type BiomeId = string;
export type DecorationTypeId = string;
export type PhraseId = string;

export type Tick = number;

// ---------------------------------------------------------------------------
// Calendar and weather (spec §9)
// ---------------------------------------------------------------------------

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

export const WEATHERS = ["clear", "rain", "drought", "frost"] as const;
export type Weather = (typeof WEATHERS)[number];

// ---------------------------------------------------------------------------
// Order and event vocabularies (spec §13)
// ---------------------------------------------------------------------------

export const ORDER_TYPES = [
  "plant",
  "harvest",
  "tend",
  "feed",
  "build",
  "upgrade",
  "craft",
  "travel",
  "help",
  "gift",
  "forage",
  "fish",
  "post_offer",
  "post_wanted_request",
  "cancel_offer",
  "accept_offer",
  "counter_offer",
  "contribute_goal",
  "place_decoration",
] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_STATUSES = ["queued", "resolved", "failed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const EVENT_TYPES = [
  "order_resolved",
  "order_failed",
  "avatar_path",
  "crop_grown",
  "crop_failed",
  "crop_withered",
  "weather",
  "blight",
  "animal_produced",
  "construction_started",
  "construction_completed",
  "craft_started",
  "craft_completed",
  "trade_completed",
  "post_created",
  "post_cancelled",
  "post_expired",
  "gift",
  "help",
  "goal_contribution",
  "goal_progress",
  "goal_completed",
  "season_change",
  "node_depleted",
  "node_regrown",
  "player_joined",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const POST_KINDS = ["offer", "wanted_request", "counter_offer"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const POST_STATUSES = ["open", "settled", "cancelled", "expired"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const GOAL_STATUSES = ["active", "succeeded", "failed", "expired"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_KINDS = ["collective_build", "festival"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const CHORES = ["water", "feed", "tend"] as const;
export type Chore = (typeof CHORES)[number];

export const CONSTRUCTION_KINDS = ["build", "upgrade"] as const;
export type ConstructionKind = (typeof CONSTRUCTION_KINDS)[number];

// ---------------------------------------------------------------------------
// Small value types
// ---------------------------------------------------------------------------

export interface TileCoord {
  x: number;
  y: number;
}

export interface ItemStack {
  item: ItemId;
  quantity: number;
}

export interface InventoryChange {
  plotId: PlotId;
  item: ItemId;
  delta: number;
}

export interface VersionSet {
  rulesVersion: string;
  contentVersion: string;
  generatorVersion: string;
}

/** Header written at the start of every tick log (spec §10). */
export interface TickHeader {
  v: 1;
  worldSeed: string;
  tick: Tick;
  generatorVersion: string;
  contentVersion: string;
  rulesVersion: string;
}

export interface TickLog extends TickHeader {
  stateHash: string;
}

export interface AvatarPathPoint {
  regionId: RegionId;
  x: number;
  y: number;
}

export interface AvatarPath {
  playerId: PlayerId;
  tick: Tick;
  from: AvatarPathPoint;
  via: AvatarPathPoint[];
  to: AvatarPathPoint;
  returnedHome: boolean;
}

// ---------------------------------------------------------------------------
// World and players
// ---------------------------------------------------------------------------

export interface WorldConfig {
  seed: string;
  generatorVersion: string;
  contentVersion: string;
  rulesVersion: string;
  /** Local wall-clock time of the daily deadline, `HH:MM`. */
  deadlineTime: string;
  timezone: string;
  minTickGapMinutes: number;
  playerCap: number;
}

export interface World {
  id: WorldId;
  config: WorldConfig;
  currentTick: Tick;
  season: Season;
  weather: Weather;
  nextDeadline: string | null;
  /** Short-lived lease used to reject mutations during resolution (spec §14). */
  resolving: ResolvingLease | null;
}

export interface ResolvingLease {
  owner: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface MissedTickDefaults {
  harvest: boolean;
  water: boolean;
  feed: boolean;
  tend: boolean;
}

export const DEFAULT_MISSED_TICK_DEFAULTS: MissedTickDefaults = {
  harvest: true,
  water: true,
  feed: true,
  tend: false,
};

export interface Player {
  id: PlayerId;
  name: string;
  plotId: PlotId;
  joinedTick: Tick;
  /** Energy for the current tick. Refreshed from content at the start of each tick. */
  energy: number;
  defaults: MissedTickDefaults;
}

export interface Credential {
  id: CredentialId;
  playerId: PlayerId;
  kind: "passkey" | "discord" | "github";
  /** Opaque provider subject identifier. */
  subject: string;
  /** Encrypted at rest for OAuth tokens; never written to the replay log. */
  secretCiphertext: string | null;
  createdAt: string;
}

export interface Session {
  id: SessionId;
  playerId: PlayerId;
  createdAt: string;
  expiresAt: string;
}

export interface Invite {
  id: InviteId;
  codeHash: string;
  createdByPlayerId: PlayerId | null;
  redeemedByPlayerId: PlayerId | null;
  createdAt: string;
  redeemedAt: string | null;
}

export interface PushSubscription {
  id: PushSubscriptionId;
  playerId: PlayerId;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Map, plots and production
// ---------------------------------------------------------------------------

export const TILE_TYPES = ["plot", "commons", "wild", "water", "blocked"] as const;
export type TileType = (typeof TILE_TYPES)[number];

export interface Traits {
  soil: number;
  water: number;
  light: number;
}

export interface Region {
  id: RegionId;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Tile {
  id: TileId;
  regionId: RegionId;
  x: number;
  y: number;
  type: TileType;
  biome: BiomeId;
  traits: Traits;
}

export interface Plot {
  id: PlotId;
  playerId: PlayerId | null;
  regionId: RegionId;
  siteX: number;
  siteY: number;
  width: number;
  height: number;
  /** World-owned plots (commons) are not claimable by players. */
  worldOwned: boolean;
}

export interface CraftJob {
  recipeId: RecipeId;
  startedTick: Tick;
  completesTick: Tick;
  inputs: ItemStack[];
  outputs: ItemStack[];
}

export interface Building {
  id: BuildingId;
  plotId: PlotId;
  type: BuildingTypeId;
  level: number;
  constructionKind: ConstructionKind | null;
  constructionCompleteTick: Tick | null;
  craftQueue: CraftJob[];
}

export interface Crop {
  id: CropId;
  plotId: PlotId;
  tileX: number;
  tileY: number;
  type: CropTypeId;
  plantedTick: Tick;
  growthTicks: number;
  watered: boolean;
  tended: boolean;
  failed: boolean;
}

export interface Animal {
  id: AnimalId;
  plotId: PlotId;
  type: AnimalTypeId;
  count: number;
  fed: boolean;
}

export interface InventoryRow {
  plotId: PlotId;
  item: ItemId;
  quantity: number;
  locked: number;
}

export interface WildNode {
  id: NodeId;
  regionId: RegionId;
  x: number;
  y: number;
  resource: ItemId;
  amount: number;
  capacity: number;
  regrowRate: number;
}

export interface WildClaim {
  playerId: PlayerId;
  nodeId: NodeId;
  tick: Tick;
  sequence: number;
}

export interface Decoration {
  id: DecorationId;
  plotId: PlotId;
  type: DecorationTypeId;
  tileX: number;
  tileY: number;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface PlantPayload {
  tile: TileCoord;
  crop: CropTypeId;
}
export interface HarvestPayload {
  tile: TileCoord;
}
export interface TendPayload {
  tile: TileCoord;
}
export interface FeedPayload {
  animalId: AnimalId;
}
export interface BuildPayload {
  building: BuildingTypeId;
  tile: TileCoord;
}
export interface UpgradePayload {
  buildingId: BuildingId;
}
export interface CraftPayload {
  buildingId: BuildingId;
  recipeId: RecipeId;
}
export interface TravelPayload {
  regionId: RegionId;
}
export interface HelpPayload {
  targetPlotId: PlotId;
  chore: Chore;
  tile?: TileCoord;
  animalId?: AnimalId;
}
export interface GiftPayload {
  toPlayerId: PlayerId;
  items: ItemStack[];
}
export interface ForagePayload {
  nodeId: NodeId;
}
export interface FishPayload {
  nodeId: NodeId;
}
export interface PostOfferPayload {
  gives: ItemStack[];
  wants: ItemStack[];
  expiryTicks: number;
}
export interface PostWantedRequestPayload {
  wants: ItemStack[];
  quantity: number;
  expiryTicks: number;
}
export interface CancelOfferPayload {
  offerId: OfferId;
}
export interface AcceptOfferPayload {
  offerId: OfferId;
}
export interface CounterOfferPayload {
  parentOfferId: OfferId;
  gives: ItemStack[];
  wants: ItemStack[];
}
export interface ContributeGoalPayload {
  goalId: GoalId;
  items: ItemStack[];
}
export interface PlaceDecorationPayload {
  decoration: DecorationTypeId;
  tile: TileCoord;
}

export interface OrderPayloadMap {
  plant: PlantPayload;
  harvest: HarvestPayload;
  tend: TendPayload;
  feed: FeedPayload;
  build: BuildPayload;
  upgrade: UpgradePayload;
  craft: CraftPayload;
  travel: TravelPayload;
  help: HelpPayload;
  gift: GiftPayload;
  forage: ForagePayload;
  fish: FishPayload;
  post_offer: PostOfferPayload;
  post_wanted_request: PostWantedRequestPayload;
  cancel_offer: CancelOfferPayload;
  accept_offer: AcceptOfferPayload;
  counter_offer: CounterOfferPayload;
  contribute_goal: ContributeGoalPayload;
  place_decoration: PlaceDecorationPayload;
}

export type OrderPayload = OrderPayloadMap[OrderType];

export type Order = {
  [K in OrderType]: {
    id: OrderId;
    playerId: PlayerId;
    tick: Tick;
    sequence: number;
    type: K;
    payload: OrderPayloadMap[K];
    status: OrderStatus;
    failureReason: string | null;
  };
}[OrderType];

export interface ReadyEntry {
  playerId: PlayerId;
  tick: Tick;
  position: number;
}

/** Goods locked when a locking order is queued (spec §4.2, §6.1, §7). */
export interface OrderLock {
  orderId: OrderId;
  plotId: PlotId;
  items: ItemStack[];
}

// ---------------------------------------------------------------------------
// Barter
// ---------------------------------------------------------------------------

export interface Offer {
  id: OfferId;
  posterId: PlayerId;
  kind: PostKind;
  gives: ItemStack[];
  wants: ItemStack[];
  quantity: number;
  createdAtTick: Tick;
  expiryTick: Tick;
  status: PostStatus;
  parentOfferId: OfferId | null;
}

// ---------------------------------------------------------------------------
// Goals and goodwill
// ---------------------------------------------------------------------------

export interface GoalReward {
  kind: "recipe" | "crop" | "building" | "map_area" | "wild_zone";
  id: string;
}

export interface Goal {
  id: GoalId;
  kind: GoalKind;
  title: string;
  requires: ItemStack[];
  rewards: GoalReward[];
  createdAtTick: Tick;
  deadlineTick: Tick;
  status: GoalStatus;
}

export interface Contribution {
  id: ContributionId;
  goalId: GoalId;
  playerId: PlayerId;
  orderId: OrderId;
  items: ItemStack[];
  status: "locked" | "consumed" | "released";
}

export interface Goodwill {
  playerId: PlayerId;
  score: number;
}

// ---------------------------------------------------------------------------
// Replay events
// ---------------------------------------------------------------------------

export interface OrderResolvedPayload {
  orderId: OrderId;
  playerId: PlayerId;
  orderType: OrderType;
}
export interface OrderFailedPayload {
  orderId: OrderId;
  playerId: PlayerId;
  orderType: OrderType;
  reason: string;
}
export interface AvatarPathPayload {
  path: AvatarPath;
}
export interface CropGrownPayload {
  cropId: CropId;
  plotId: PlotId;
  tile: TileCoord;
  cropType: CropTypeId;
}
export interface CropFailedPayload {
  cropId: CropId;
  plotId: PlotId;
  tile: TileCoord;
  reason: string;
}
export interface CropWitheredPayload {
  cropId: CropId;
  plotId: PlotId;
  tile: TileCoord;
  reason: string;
}
export interface WeatherPayload {
  weather: Weather;
  season: Season;
}
export interface BlightPayload {
  nodeId?: NodeId;
  plotId?: PlotId;
  tile?: TileCoord;
  reason: string;
}
export interface AnimalProducedPayload {
  animalId: AnimalId;
  plotId: PlotId;
  item: ItemId;
  quantity: number;
}
export interface ConstructionPayload {
  buildingId: BuildingId;
  plotId: PlotId;
  buildingType: BuildingTypeId;
  kind: ConstructionKind;
  completesTick: Tick;
}
export interface CraftPayloadEvent {
  buildingId: BuildingId;
  plotId: PlotId;
  recipeId: RecipeId;
  completesTick: Tick;
}
export interface TradeCompletedPayload {
  offerId: OfferId;
  parentOfferId: OfferId | null;
  buyerId: PlayerId;
  sellerId: PlayerId;
  gives: ItemStack[];
  wants: ItemStack[];
}
export interface PostCreatedPayload {
  offerId: OfferId;
  posterId: PlayerId;
  kind: PostKind;
  expiryTick: Tick;
  parentOfferId: OfferId | null;
}
export interface PostCancelledPayload {
  offerId: OfferId;
  reason: "cancelled" | "cascade" | "settled";
}
export interface PostExpiredPayload {
  offerId: OfferId;
}
export interface GiftPayloadEvent {
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  items: ItemStack[];
}
export interface HelpPayloadEvent {
  helperId: PlayerId;
  hostPlayerId: PlayerId;
  plotId: PlotId;
  chore: Chore;
}
export interface GoalContributionPayload {
  goalId: GoalId;
  playerId: PlayerId;
  items: ItemStack[];
}
export interface GoalProgressPayload {
  goalId: GoalId;
  progress: ItemStack[];
  complete: boolean;
}
export interface GoalCompletedPayload {
  goalId: GoalId;
  rewards: GoalReward[];
}
export interface SeasonChangePayload {
  season: Season;
  year: number;
}
export interface NodePayload {
  nodeId: NodeId;
  resource: ItemId;
  amount: number;
}
export interface PlayerJoinedPayload {
  playerId: PlayerId;
  plotId: PlotId;
}

export interface EventPayloadMap {
  order_resolved: OrderResolvedPayload;
  order_failed: OrderFailedPayload;
  avatar_path: AvatarPathPayload;
  crop_grown: CropGrownPayload;
  crop_failed: CropFailedPayload;
  crop_withered: CropWitheredPayload;
  weather: WeatherPayload;
  blight: BlightPayload;
  animal_produced: AnimalProducedPayload;
  construction_started: ConstructionPayload;
  construction_completed: ConstructionPayload;
  craft_started: CraftPayloadEvent;
  craft_completed: CraftPayloadEvent;
  trade_completed: TradeCompletedPayload;
  post_created: PostCreatedPayload;
  post_cancelled: PostCancelledPayload;
  post_expired: PostExpiredPayload;
  gift: GiftPayloadEvent;
  help: HelpPayloadEvent;
  goal_contribution: GoalContributionPayload;
  goal_progress: GoalProgressPayload;
  goal_completed: GoalCompletedPayload;
  season_change: SeasonChangePayload;
  node_depleted: NodePayload;
  node_regrown: NodePayload;
  player_joined: PlayerJoinedPayload;
}

export type GameEvent = {
  [K in EventType]: {
    tick: Tick;
    sequence: number;
    version: 1;
    type: K;
    payload: EventPayloadMap[K];
  };
}[EventType];

export type EventPayload = EventPayloadMap[EventType];

export interface ArchivedEvent {
  tick: Tick;
  sequence: number;
  version: 1;
  type: EventType;
  payload: JsonObject;
}

// ---------------------------------------------------------------------------
// Whole-world state used by the pure rules engine
// ---------------------------------------------------------------------------

export interface WorldState {
  world: World;
  players: Player[];
  regions: Region[];
  tiles: Tile[];
  plots: Plot[];
  buildings: Building[];
  crops: Crop[];
  animals: Animal[];
  inventory: InventoryRow[];
  orders: Order[];
  orderLocks: OrderLock[];
  ready: ReadyEntry[];
  offers: Offer[];
  wildNodes: WildNode[];
  claims: WildClaim[];
  goals: Goal[];
  contributions: Contribution[];
  goodwill: Goodwill[];
  decorations: Decoration[];
  nextOrderSequence: number;
  /** Unlocks granted by completed goals, applied at the next tick (spec §9). */
  unlockedRecipes: RecipeId[];
  unlockedCrops: CropTypeId[];
  unlockedBuildings: BuildingTypeId[];
  unlockedRegions: RegionId[];
  unlockedNodes: NodeId[];
}

// ---------------------------------------------------------------------------
// Content (spec §12, §13)
// ---------------------------------------------------------------------------

export interface EnergyConfig {
  dailyBudget: number;
  travelPerBoundary: number;
  costs: Record<OrderType, number>;
}

export interface GoodwillConfig {
  gift: number;
  help: number;
}

export interface CropDefinition {
  id: CropTypeId;
  name: string;
  growthTicks: number;
  seasons: Season[];
  yield: ItemStack[];
  wateringRequired: boolean;
  tendingRequired: boolean;
  frostSensitive: boolean;
  unlockedByDefault: boolean;
}

export interface AnimalDefinition {
  id: AnimalTypeId;
  name: string;
  produces: ItemStack[];
  feedItem: ItemId;
}

export interface RecipeDefinition {
  id: RecipeId;
  name: string;
  building: BuildingTypeId;
  buildingLevel: number;
  inputs: ItemStack[];
  outputs: ItemStack[];
  durationTicks: number;
  unlockedByDefault: boolean;
}

export interface BuildingDefinition {
  id: BuildingTypeId;
  name: string;
  biomeLocks: BiomeId[] | null;
  maxLevel: number;
  levels: BuildingLevelDefinition[];
}

export interface BuildingLevelDefinition {
  level: number;
  cost: ItemStack[];
  energyCost: number;
  durationTicks: number;
  storageCapacity: number;
  unlocksRecipes: RecipeId[];
}

export interface BiomeDefinition {
  id: BiomeId;
  name: string;
  traits: Traits;
}

export interface WeatherDefinition {
  id: Weather;
  name: string;
  countsAsWatering: boolean;
  failureChance: number;
  frostDamage: boolean;
}

export interface GoalDefinition {
  id: GoalId;
  kind: GoalKind;
  title: string;
  requires: ItemStack[];
  rewards: GoalReward[];
  durationTicks: number;
}

export interface PhraseDefinition {
  id: PhraseId;
  text: string;
}

export interface WildNodeDefinition {
  id: string;
  resource: ItemId;
  capacity: number;
  regrowRate: number;
}

export interface DecorationDefinition {
  id: DecorationTypeId;
  name: string;
  cost: ItemStack[];
}

export interface ContentPack {
  version: string;
  items: Record<ItemId, { name: string }>;
  energy: EnergyConfig;
  goodwill: GoodwillConfig;
  crops: CropDefinition[];
  animals: AnimalDefinition[];
  recipes: RecipeDefinition[];
  buildings: BuildingDefinition[];
  biomes: BiomeDefinition[];
  weather: WeatherDefinition[];
  goals: GoalDefinition[];
  phrases: PhraseDefinition[];
  wildNodes: WildNodeDefinition[];
  decorations: DecorationDefinition[];
}

// ---------------------------------------------------------------------------
// Order runtime context
// ---------------------------------------------------------------------------

export interface OrderContext {
  previousTick: Tick;
  currentTick: Tick;
  weather: Weather;
  season: Season;
  content: ContentPack;
  /** Player location at this point in their turn, starting at their own plot. */
  location: RegionId;
  /** Regions reached by travel orders earlier in this player's queue. */
  reachable: Set<RegionId>;
}
