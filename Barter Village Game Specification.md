# Barter Village: Game Specification

*Working title. Draft 2, revised 7 November 2026.*

## 1. Overview

A persistent, shared, turn-based farming and crafting world for fewer than 20 friends, played in a browser in 2D pixel art. Each player owns a plot on a shared generated map and develops it through farming, animals, foraging, fishing, cooking and crafting. Players trade through a public barter board. There is no money of any kind. The world advances in daily ticks, and after each tick players watch a replay of everything that happened.

## 2. Design pillars

- **Shape your home.** Fixed plots with upgradeable buildings and decorations. Specialisation emerges from which buildings you upgrade.
- **Need each other.** Plots differ by biome and traits, and some buildings and resources are biome-locked, so barter is necessary.
- **One shared timeline.** Everyone's orders resolve together at one tick, and everyone can watch the same replay.
- **Short, cozy sessions.** About 15 minutes a day, with batch orders to keep that realistic.
- **Small and self-hosted.** Under 20 players, one cheap VPS, permissively licensed code.

## 3. Scope and constraints

- One endless world with no end state. Fewer than 20 players, friends only.
- Browser client, desktop-first.
- Setting: rustic, timeless countryside.
- Code licence: MIT or Apache. Art assets are licensed separately, with a credits file.
- **Out of scope for v1:** currency or coins of any kind, competitive actions (raids, theft), free-text chat, mobile-first UI, real-time movement, multiple worlds.

**v1 acceptance criteria:**
- 20 concurrent players can complete a tick resolution in <60s on a single VPS.
- A new player can board, queue a full day's orders, and watch the replay in <15 minutes on first tick.
- Server is authoritative: a tampered client cannot spend energy/goods it does not have.
- Tick resolution is atomic: a crash mid-tick leaves no partial state; replay log matches resolved state.
- Nightly backup restores to a fresh VPS and passes golden-log tests.

## 4. Time and turns

### 4.1 The tick

- One tick is one in-game day. Resolution is simultaneous: players queue orders, and the server resolves them together.
- A tick fires when every player has marked ready, or at the host-set fixed daily deadline, whichever comes first.
- A worker checks every minute, so a tick can start up to a minute after the last player readies.
- While a tick resolves, edits are rejected with a “tick in progress” message.
- Early tick: the next deadline is always the next fixed daily deadline after resolution — never immediately re-armed.

### 4.2 Ready state and resolution order

- Marking ready fixes the player's position in the resolution queue. A player can un-ready to edit, but goes to the back of the queue.
- Validated queue order is: (1) ready players by ready position ascending, (2) unready players by player ID ascending. The same order applies to any player-vs-player contention (e.g. accepting the same offer).
- Within one player's turn, orders run in queue order.
- Wild resource claims do not depend on order — see §6.2 for the split formula.
- Failure handling: a failed order logs a reason, costs no energy and no goods, and the next order in that player's queue still runs.

### 4.3 Energy

- Every player gets the same fixed daily energy budget (tunable constant, default 100 in v1 playtest build).
- Actions cost energy. Building upgrades cost goods, energy and waiting ticks.
- Travel is free within your own region and costs energy beyond it (cost = 5 per region boundary crossed, tunable). Helping on another player's plot costs the helper's energy.
- Batch orders ("fill this row or area") keep the click count manageable for a 15-minute session.
- Exact budget and per-action costs are defined in the content JSON (see §12) and tuned in playtesting.

### 4.4 Missed ticks

- A player's plot always persists. Plots are never reclaimed.
- Default orders applied on a missed tick, in this order, when enabled by the player (all on by default):
  1. Auto-water unwatered crops on own plot.
  2. Auto-harvest ripe crops on own plot.
  3. Auto-feed fed animals on own plot.
- Defaults respect energy and capacity: they stop when energy or storage is exhausted, log what they did, and never queue expensive actions (building, crafting, trading).

## 5. The map

- One shared map made of regions, generated deterministically from a world seed. It grows as players join, and existing plots never move.
- The whole map is stored explicitly in the database.
- Each region contains player plots, a shared commons (shared buildings, wild forage) and wild zones.
- Sites differ by **biome** (for example meadow, forest edge, riverside, coast, hills) plus per-site **traits** (soil, water, light). The final biome list belongs to the content phase.
- A new player picks from the currently open sites. When open sites run low, the generator appends a new region.
- **Wild zones** hold limited resources that regrow slowly and can be depleted by over-harvesting. Shared water zones support fishing.
- Shared goals can unlock new map areas or wild zones.
- Avatars appear on the map through the replay, which is how players see each other moving between locations.
- Region geometry: regions have a stable ID, a grid coordinate (x, y), and per-plot tile coordinates. Travel cost in §4.3 is computed from grid distance between origin and destination regions.

## 6. Plots, buildings and production

### 6.1 Plots and buildings

- Each plot is about 12x12 tiles. Everyone starts with a **home**, a **field** and a **storehouse**.
- About 8 building types in v1. Some are biome-locked (for example a dock only on riverside or coast sites).
- Upgrades cost **goods, energy and waiting ticks**. Upgrades unlock recipes, capacity or speed. Specialisation emerges from which buildings a player upgrades.
- Each storage building has a capacity that upgrades raise. Items are plain stackable goods, with no quality tiers and no spoilage.

### 6.2 Production lines

- **Crops:** about 15 in v1. Growth takes 1 to 7 ticks (up to a season). The current season decides which crops can grow.
- **Crop failure:** caused by weather, neglect (untended or unwatered crops) and random pests or blight. Failure is per tile, so a field can partly fail. Stored goods are never lost.
- **Animals and livestock:** need daily feeding orders, which cost energy. Unfed animals skip production that tick and nothing else happens.
- **Foraging:** done in wild zones by travelling there and issuing a claim order. Yields are split evenly among valid claimants: each claimant gets `floor(nodeYield / claimantCount)` units, the remainder stays on the node, and claims that fail travel/energy validation do not count.
- **Fishing:** at your own dock (biome-locked) and at shared wild water zones.
- **Cooking and baking, and crafting** (wood, metal, textiles): about 40 recipes in v1. Time varies by recipe: instant at the next tick, or N ticks through a per-building queue.
- **Recipe discovery:** gated by building level, with some recipes unlocked by shared goals.
- **Decorations:** cosmetic, placed on a plot, and either crafted or earned (goodwill, shared goals).

## 7. The barter economy

- There is **no currency**. Goods are traded for goods.
- All offers are public, on one shared board. Players can post **offers** ("I give X, I want Y") and **wanted requests** ("I want Y"), and either can receive **counter-offers**.
- Posting an offer locks the offered goods, up to what the player holds. Offers stay open until cancelled or expired. Default expiry is 7 ticks, configurable by the poster between 1 and 28 ticks.
- Offers are all-or-nothing: no partial fills in v1.
- When a counter-offer is made, the original offer stays open alongside it. Both lock their own goods independently.
- Cap: a player may have at most 10 open offers + counter-offers combined in v1.
- **Counter-offer lifecycle:** if the original offer it counters is accepted, cancelled, or expires, all its counter-offers auto-cancel and release their locked goods. Accepting a counter-offer resolves it like a normal offer and cancels the original it counters (releasing its locks).
- Everything settles at the tick, so one negotiation round takes one day.
- The UI must show free stock (held minus locked) clearly. The server enforces that locked goods cannot be spent, gifted, or re-offered.

## 8. Social interaction

- Visitors can look at plots and trade, and can do cooperative extras: gifts and helping with chores.
- When a visitor helps with a chore, the helper pays the energy, the host gets the benefit, and the helper earns a small goodwill bonus.
- **Goodwill is cosmetic only** (score, badges, decorations). It is not tradeable and has no functional effect, so it cannot become a currency. Formula in v1: +1 per helped chore, +5 per gift, displayed only.
- Communication is a limited **phrase book**: players choose from a fixed list of phrases. This needs no moderation and is easy to localise.

## 9. Seasons, weather and shared goals

- A season is 7 ticks. Seasons change which crops can grow, weather odds and blight risk, and wild resource availability.
- Weather is simple: clear, rain, drought, frost. It is rolled from a seeded RNG each tick.
- Shared goals come in two forms: collective builds funded by everyone's contributed goods, and seasonal festivals with group quotas. The schedule is host-configurable.
- Success unlocks rewards for everyone: new recipes, crop varieties, building types, and map areas or wild zones. There is no punishment for failure.

## 10. Replay

- After each tick, the client replays everything that happened everywhere. Players can replay the most recent tick as many times as they like and follow different locations.
- The server writes the full event log, including complete avatar movement paths. The client only plays it back.
- Players only see the latest tick, but every tick's log is archived on the server.
- Replay events carry a schema version (`v: 1`) and world seed + tick number so golden-log tests can verify deterministic output.

## 11. Presentation

- 32x32 pixel tiles from free-licensed packs (for example OpenGameArt or Kenney). Keep a credits file and check each pack's licence terms. Every pack must be verified compatible with redistribution before use.
- PixiJS renders the map and replay. Preact (or vanilla TypeScript) builds the panels for orders, market and inventory.
- Desktop-first layout. Optional music and sound effects.
- A short guided first tick onboards new players.
- Web push notifies players when a tick has resolved. This needs a service worker and VAPID keys, and iOS only supports push for installed web apps.

## 12. Architecture

| Area | Decision |
| --- | --- |
| Language | TypeScript end to end, with a shared pure rules package |
| Server | Single Node process, plain REST with JSON |
| Database | SQLite via better-sqlite3 with raw SQL (WAL mode) |
| Tick worker | Separate worker process or systemd timer that polls every minute and resolves each tick in one transaction |
| Live updates | Client polling |
| State storage | Current-state tables plus an archived event log for every tick |
| Content | JSON files validated by a schema (energy costs, recipes, crops, buildings, biomes, phrase book) |
| Client rules | Light checks only (energy, basic validity). The server is authoritative |
| Auth | Passkeys plus Discord and GitHub OAuth, with no passwords. WebAuthn needs HTTPS and a stable domain |
| Push | Web push |
| Backups | Nightly off-site copy (S3-compatible), using SQLite's online backup |
| Deployment | NixOS on a cheap VPS (flake plus NixOS service module) |
| Testing | Rules unit tests plus golden tick logs |
| Admin | Config file and the database only |

Threat model (v1): a modified client can only queue orders it could queue from the genuine UI; every order is re-validated server-side against current state, energy, capacity, and locks before resolution. No passwords stored; OAuth tokens and passkey credentials are the only secrets.

## 13. Data model sketch

**Entities:** players, credentials, push subscriptions, world (seed, current tick, season, deadline), regions (id, grid x/y), tiles (region, x, y, type, biome, traits), plots (player, region, site coords), buildings (plot, type, level, queue), inventory (plot/player, item, quantity, locked quantity), orders (player, tick, sequence, type, payload, status), ready state (player, tick, ready position), offers and counter-offers (poster, gives, wants, locked, expiry tick, status, parent offer id), wild nodes (region, coords, resource, amount, regrow rate), goals and contributions, goodwill (player, score), decorations, archived events (tick, sequence, version, type, payload) plus avatar paths.

**Order types:** plant, harvest, tend, feed, build, upgrade, craft, travel or visit, help with chore, gift, forage, fish, post offer, cancel offer, accept offer, counter-offer, contribute to goal, place decoration.

**Event types:** order resolved or failed, avatar path, crop grown or failed, weather, blight, animal produced, craft completed, trade completed, gift, help, goal progress, season change, node depleted or regrown.

Constraints: `locked <= quantity` enforced in DB and server; at most one ready entry per player per tick; expired offers cannot be accepted; node amount never goes below 0.

## 14. Tick resolution (proposed algorithm)

1. Lock out edits and load the world state.
2. Seed the RNG from the world seed and the tick number.
3. Run the world update first: weather, crop growth, blight, animal production, crafting progress, wild regrowth, goal checks and season rollover. This gives orders correct post-growth state (e.g. ripe crops to harvest).
4. Order players: ready by ready position, then unready by player ID. Run each player's orders in queue order, validating against current state (energy, goods, capacity, locks, conflicts) and logging failures.
5. Resolve wild claim splits (formula in §6.2) as part of the forage orders in step 4, using the claimant set collected from all valid forage orders queued for that tick.
6. Write the event log, advance the tick, set the next deadline (next fixed daily deadline), unlock, and send push notifications.

Everything runs in one database transaction, so a crash leaves the previous tick intact.

## 15. Open questions and risks

- **Ready-order fairness:** conflicts reward players who ready early. Consider whether barter conflicts need a fairer tie-break in a later version; v1 keeps queue order for simplicity.
- **Energy budget and costs, goodwill tuning, phrase book contents, final biome and content lists:** to be defined in content JSON and tuned in playtesting.
- **Art licensing:** verify each pack's licence is compatible with how you publish it before adding to the repo.
- **Push on iOS:** requires the web app to be installed to the home screen.

Resolved in this draft: unready-player tie-break (player ID), counter-offer cascade (auto-cancel on parent resolution), offer lock cap (10) and expiry (default 7 ticks), early-tick deadline rule, player-orders-vs-world-update order (world first, then orders), wild split formula, missed-tick defaults.

## 16. Suggested milestones

1. Repo, Nix flake and dev shell, shared rules package skeleton.
2. Rules core with golden-log tests.
3. Map generator and database schema.
4. Auth and REST API.
5. Client: plot view and order queue.
6. Tick worker and replay playback.
7. Barter board.
8. Seasons, weather and shared goals, plus web push.
9. Content pass (crops, buildings, recipes) and onboarding.
10. Deployment, backups and a friends playtest.
