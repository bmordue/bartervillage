# Barter Village: Game Specification

*Working title. Draft 1, compiled 6 November 2026 from the design Q&A.*

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

## 4. Time and turns

### 4.1 The tick

- One tick is one in-game day. Resolution is simultaneous: players queue orders, and the server resolves them together.
- A tick fires when every player has marked ready, or at the host-set fixed daily deadline, whichever comes first.
- A worker checks every minute, so a tick can start up to a minute after the last player readies.
- While a tick resolves, edits are rejected with a “tick in progress” message.

### 4.2 Ready state and resolution order

- Marking ready fixes the player's place in the resolution queue. A player can un-ready to edit, but goes to the back of the queue.
- At the deadline, players who queued orders but never marked ready have their orders run, resolved after everyone who was ready.
- Within one player's turn, orders run in their own queue order.
- Queue order only matters for conflicts, such as two players accepting the same offer. Wild resource claims are split evenly and do not depend on order.

### 4.3 Energy

- Every player gets the same fixed daily energy budget.
- Actions cost energy. Building upgrades cost goods, energy and waiting ticks.
- Travel is free within your own region and costs energy beyond it. Helping on another player's plot costs the helper's energy.
- Batch orders (“fill this row or area”) keep the click count manageable for a 15-minute session.
- The exact budget and per-action costs are to be tuned in playtesting.

### 4.4 Missed ticks

- A player's plot always persists. If they miss ticks, simple default orders apply (for example, auto-harvest). Plots are never reclaimed.

## 5. The map

- One shared map made of regions, generated deterministically from a world seed. It grows as players join, and existing plots never move.
- The whole map is stored explicitly in the database.
- Each region contains player plots, a shared commons (shared buildings, wild forage) and wild zones.
- Sites differ by **biome** (for example meadow, forest edge, riverside, coast, hills) plus per-site **traits** (soil, water, light). The final biome list belongs to the content phase.
- A new player picks from the currently open sites. When open sites run low, the generator appends a new region.
- **Wild zones** hold limited resources that regrow slowly and can be depleted by over-harvesting. Shared water zones support fishing.
- Shared goals can unlock new map areas or wild zones.
- Avatars appear on the map through the replay, which is how players see each other moving between locations.

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
- **Foraging:** done in wild zones by travelling there and issuing a claim order. Yields are split evenly among claimants.
- **Fishing:** at your own dock (biome-locked) and at shared wild water zones.
- **Cooking and baking, and crafting** (wood, metal, textiles): about 40 recipes in v1. Time varies by recipe: instant at the next tick, or N ticks through a per-building queue.
- **Recipe discovery:** gated by building level, with some recipes unlocked by shared goals.
- **Decorations:** cosmetic, placed on a plot, and either crafted or earned (goodwill, shared goals).

## 7. The barter economy

- There is **no currency**. Goods are traded for goods.
- All offers are public, on one shared board. Players can post **offers** (“I give X, I want Y”) and **wanted requests** (“I want Y”), and either can receive **counter-offers**.
- Posting an offer locks the offered goods, up to what the player holds. Offers stay open until cancelled. When a counter-offer is made, the original offer stays open alongside it.
- Everything settles at the tick, so one negotiation round takes one day.
- The UI must show free stock (held minus locked) clearly.

## 8. Social interaction

- Visitors can look at plots and trade, and can do cooperative extras: gifts and helping with chores.
- When a visitor helps with a chore, the helper pays the energy, the host gets the benefit, and the helper earns a small goodwill bonus.
- **Goodwill is cosmetic only** (score, badges, decorations). It is not tradeable and has no functional effect, so it cannot become a currency.
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

## 11. Presentation

- 32x32 pixel tiles from free-licensed packs (for example OpenGameArt or Kenney). Keep a credits file and check each pack's licence terms.
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
| Content | JSON files validated by a schema |
| Client rules | Light checks only (energy, basic validity). The server is authoritative |
| Auth | Passkeys plus Discord and GitHub OAuth, with no passwords. WebAuthn needs HTTPS and a stable domain |
| Push | Web push |
| Backups | Nightly off-site copy (S3-compatible), using SQLite's online backup |
| Deployment | NixOS on a cheap VPS (flake plus NixOS service module) |
| Testing | Rules unit tests plus golden tick logs |
| Admin | Config file and the database only |

## 13. Data model sketch

**Entities:** players, credentials, push subscriptions, world (seed, current tick, season, deadline), regions, tiles, plots, buildings, inventory (quantity and locked quantity), orders (player, tick, sequence, type, payload, status), ready state (with ready position), offers and counter-offers, wild nodes, goals and contributions, goodwill, decorations, archived events (tick, sequence, type, payload).

**Order types:** plant, harvest, tend, feed, build, upgrade, craft, travel or visit, help with chore, gift, forage, fish, post offer, cancel offer, accept offer, counter-offer, contribute to goal, place decoration.

**Event types:** order resolved or failed, avatar path, crop grown or failed, weather, blight, animal produced, craft completed, trade completed, gift, help, goal progress, season change, node depleted or regrown.

## 14. Tick resolution (proposed algorithm)

1. Lock out edits and load the world state.
2. Seed the RNG from the world seed and the tick number.
3. Order players by ready position, then run each player's orders in queue order. Validate every order against the current state (energy, goods, conflicts) and log failures.
4. Run the world update: weather, crop growth, blight, animal production, crafting progress, wild regrowth, goal checks and season rollover.
5. Write the event log, advance the tick, set the next deadline, unlock, and send push notifications.

Everything runs in one database transaction, so a crash leaves the previous tick intact.

## 15. Open questions and risks

- **Unready players' order:** how are late players resolved relative to each other? Proposal: by player ID.
- **Ready-order fairness:** conflicts reward players who ready early. Consider whether barter conflicts need a fairer tie-break.
- **Counter-offer lifecycle:** what happens to counters, and their locked goods, when the original offer is accepted? Proposal: auto-cancel and release.
- **Open offers lock goods indefinitely:** consider a cap on simultaneous open offers.
- **Early ticks:** after an early tick, does the next deadline stay at the fixed daily time?
- **Order of player orders vs world update** in the tick (step 3 vs step 4) needs confirming.
- **Energy budget and costs, goodwill formula, regions and travel-cost model, phrase book contents, final biome and content lists:** all to be defined.
- **Art licensing:** verify each pack's licence is compatible with how you publish it.
- **Push on iOS:** requires the web app to be installed to the home screen.

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
