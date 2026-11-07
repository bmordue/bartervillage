# Barter Village: Game Specification

*Working title. Draft 3, revised 7 November 2026. This draft resolves internal inconsistencies in Draft 2; open questions are listed in §15.*

## 1. Overview

A persistent, shared, turn-based farming and crafting world for up to 20 friends, played in a desktop browser in 2D pixel art. Each player owns a plot on a shared generated map and develops it through farming, animals, foraging, fishing, cooking and crafting. Players trade through a public barter board. There is no money of any kind. The world advances in daily ticks, and after each tick players watch a replay of everything that happened.

## 2. Design pillars

- **Shape your home.** Fixed plots with upgradeable buildings and decorations. Specialisation emerges from which buildings you upgrade.
- **Need each other.** Plots differ by biome and traits, and some buildings and resources are biome-locked, so barter is necessary.
- **One shared timeline.** Everyone's orders resolve together at one tick, and everyone can watch the same replay.
- **Short, cozy sessions.** About 15 minutes a day, with batch orders to keep that realistic.
- **Small and self-hosted.** Up to 20 players, one cheap VPS, permissively licensed code.

## 3. Scope and constraints

- One endless world with no end state. Up to 20 players, friends only. Access is invite-only.
- Browser client, desktop-first. Mobile browsers can view replays, but a mobile-first UI is out of scope for v1.
- Setting: rustic, timeless countryside.
- Code licence: MIT or Apache. Art assets are licensed separately, with a credits file.
- **Out of scope for v1:** currency or coins of any kind, competitive actions (raids, theft), free-text chat, mobile-first UI, real-time movement, multiple worlds.

**v1 acceptance criteria:**
- Tick resolution for 20 players, each with a full day's orders, completes in under 60 seconds on the deployment VPS (p95 over a 28-tick soak test).
- A new player can complete onboarding, queue a full day of orders, and watch the resulting replay in a single 15-minute session.
- Server is authoritative: a tampered client cannot spend energy or goods it does not have.
- Tick resolution is atomic: a crash mid-tick leaves no partial state, and the replay log matches the resolved state.
- Nightly backup restores onto a fresh VPS and passes the golden-log suite.
- Every inventory change is explained by an event; production and consumption are the only sources and sinks, and golden tests assert this.

## 4. Time and turns

### 4.1 The tick

- One tick is one in-game day. Resolution is simultaneous: players queue orders, and the server resolves them together.
- A tick fires when every player has marked ready, or at the host-set daily deadline, whichever comes first. Players who have not marked ready still have their orders resolved, after ready players (§4.2).
- The deadline is stored as a local time and an IANA timezone in world config. The next deadline is the next occurrence strictly after the resolution time and at least `min_tick_gap` later (default 60 minutes). This prevents an early or late-running tick from immediately re-arming. Deadline changes take effect at the next tick.
- A worker checks every minute, so a tick starts within 60 seconds of the trigger. A worker that cannot acquire the global tick lock exits without resolving.
- While a tick resolves, mutations are rejected with a "tick in progress" response (§14).
- A player who joins after a tick starts is excluded from that tick and takes part from the next one.
- Early-tick example: with a 20:00 deadline, if everyone readies at 09:00, that tick resolves immediately and the next tick's deadline remains 20:00 the same day. If resolution finishes at 19:59:40, `min_tick_gap` moves the next deadline to 20:00 the following day.

### 4.2 Ready state and resolution order

- Marking ready fixes the player's position in the resolution queue. A player can un-ready to edit, but re-readying goes to the back of the queue. Ready state can change until the tick starts.
- Validated queue order is: (1) ready players by ready position ascending, (2) unready players by player ID ascending. The same order applies to any player-vs-player contention (e.g. accepting the same offer).
- A player may ready with an empty queue; this records readiness but does nothing.
- Within one player's turn, orders run in queue order.
- Batch orders ("fill this row or area") are expanded into per-unit orders when queued. Each unit is atomic and can fail independently.
- Orders are atomic: all-or-nothing. A failed order logs a reason, costs no energy and no goods, releases any locks it took, and the next order in that player's queue still runs.
- Editing the queue before the tick is allowed. Removing an order releases any locks it took.
- An order that targets a remote site validates that a travel order earlier in the same queue reached that region.
- Wild resource claims do not depend on queue order; see §6.2 for the split formula.
- Ready positions are monotonic per tick; un-readying and re-readying assigns a new position.

### 4.3 Energy

- Every player gets the same fixed daily energy budget (tunable constant, default 100 in the v1 playtest build). It refreshes at each tick; unspent energy does not carry over.
- Actions cost energy. Building upgrades cost goods, energy and waiting ticks.
- Travel is free within your own region and costs energy beyond it (5 per region boundary crossed, tunable). A boundary crossing is one step on the region grid; diagonal neighbours count as two steps. A travel order moves the avatar to the target region. Orders that act on a remote site must follow a travel order to that region in the same queue. The avatar returns home at the end of the tick at no extra cost. Trades are board-wide and need no travel.
- Helping on another player's plot costs the helper's energy; travel to another region is paid by the travel order. The host pays nothing.
- Batch orders keep the click count manageable for a 15-minute session.
- Exact budget and per-action costs are defined in the content JSON (see §12) and tuned in playtesting.
- Forage and fishing claims reserve energy when validated. A valid claim spends its energy even if its computed share is zero.

### 4.4 Missed ticks

- A player's plot always persists. Plots are never reclaimed.
- If a player has not marked ready by the tick, default orders are appended after their explicit orders, in this order, when enabled by the player (all on by default):
  1. Auto-harvest ripe crops on the player's own plot.
  2. Auto-water unwatered crops on the player's own plot.
  3. Auto-feed hungry animals on the player's own plot.
- Harvest before watering keeps defaults from spending water on crops that leave the field this tick.
- Defaults respect energy and capacity: they stop when energy or storage is exhausted, log what they did, and never queue building, crafting, trading, gifting or goal contributions.
- Default orders are ordinary orders and appear in the replay.

## 5. The map

- One shared map made of regions, generated deterministically from a world seed and a pinned `generator_version`. It is stored explicitly in the database. Existing plots never move and existing regions never regenerate.
- The map grows as players join. New regions are appended in a deterministic order. If no open sites remain, the generator appends a new region.
- A new player picks from the currently open sites. A site is claimed transactionally during onboarding and becomes permanent; simultaneous claims resolve first-write-wins.
- Each region contains player plots, a shared commons (shared buildings, wild forage) and wild zones.
- Sites differ by **biome** (for example meadow, forest edge, riverside, coast, hills) plus per-site **traits** (soil, water, light). The final biome list belongs to the content phase.
- Commons are world-owned, not player-owned. Shared buildings are funded by goals rather than built by individuals. Wild nodes in commons and wild zones are public.
- **Wild zones** hold limited resources that regrow slowly and can be depleted by over-harvesting. Shared water zones support fishing.
- Shared goals can unlock new map areas or wild zones.
- Avatars start each tick at their own plot, move via travel orders, and return home at the end of the tick. The replay shows these paths, which is how players see each other moving between locations.
- Region geometry: regions have a stable ID, a grid coordinate (x, y), and per-plot tile coordinates. Travel cost in §4.3 is computed from Manhattan distance between the origin and destination regions. Region size and plot count are world-generation constants.

## 6. Plots, buildings and production

### 6.1 Plots and buildings

- Each plot is about 12x12 tiles. Everyone starts with a **home**, a **field** and a **storehouse**.
- About 8 building types in v1. Some are biome-locked (for example a dock only on riverside or coast sites).
- Upgrades cost **goods, energy and waiting ticks**. Upgrades unlock recipes, capacity or speed. Specialisation emerges from which buildings a player upgrades. Construction inputs lock when the order is queued and are consumed when work starts.
- A building can have at most one construction or upgrade in progress at a time; a second upgrade order fails until the first completes. An upgrade ordered at tick T with duration N completes at the start of tick T+N, in the world update before orders.
- Each storage building has a capacity that upgrades raise. Locked goods still occupy storage; free stock is held minus locked. Items are plain stackable goods, with no quality tiers and no spoilage.

### 6.2 Production lines

- **Crops:** about 15 in v1. Growth takes 1 to 7 ticks (up to a season). The current season decides which crops can grow. A crop planted at tick T with growth N becomes ripe at the start of tick T+N if it received the required watering and tending during each growth tick and did not fail.
- **Watering and tending:** orders at tick T set flags used by the T+1 world update. Flags reset after that update. A newly planted crop starts unwatered and untended; later orders in the same queue can water or tend it.
- **Crop failure:** caused by weather, neglect (untended or unwatered crops) and random pests or blight. Failure is per tile: it destroys that tile's crop with no yield, leaves stored goods untouched, and the tile can be replanted. At season rollover, crops that cannot grow in the new season wither.
- **Animals and livestock:** need daily feeding orders, which cost energy. A feed order at tick T satisfies the T+1 production check. An unfed animal skips that check; it is not lost and nothing else happens.
- **Foraging:** done at wild nodes in wild zones and commons by travelling there and issuing a claim order. Yields are split evenly among valid claimants:
  - A claim is valid if the node has at least one unit, the player is in the node's region (their own region, or a region reached by an earlier travel order), has the energy, and has some free storage. Energy is reserved and the claim is recorded during the player's turn; no yield is applied yet.
  - After all players' turns, each node's claimant set is fixed. A player may register at most one claim per node per tick. Claims that fail travel, energy or storage validation are excluded.
  - Each claimant gets `floor(nodeYield / claimantCount)` units, where `nodeYield` is the node amount after regrowth at the start of the tick. The remainder stays on the node. A share can be zero; a valid claim still spends its energy.
  - Shares are applied in queue order, capped by free storage. Overflow stays on the node and is logged as a partial fill.
- **Fishing:** at your own dock (biome-locked) and at shared water zones. Dock fishing is private and has no split. Shared water fishing uses the same claim-and-split rule as foraging.
- **Cooking, baking and crafting** (wood, metal, textiles): about 40 recipes in v1. Instant recipes produce during the tick's order phase. Timed recipes enter a per-building FIFO queue when the order resolves; an idle building starts the first job immediately, and queued jobs start when the previous job completes. A job that starts at tick S with duration N completes at the start of tick S+N. Each building processes one job at a time. Inputs lock when the order is queued and are consumed when the job starts; removing the order before the tick releases the lock, but resolved jobs cannot be cancelled.
- **Recipe discovery:** gated by building level, with some recipes unlocked by shared goals. Unlocks take effect at the start of the next tick after the goal succeeds.
- **Decorations:** cosmetic, placed on a plot, and either crafted or earned (goodwill, shared goals). They do not affect production.

## 7. The barter economy

- There is **no currency**. Goods are traded for goods.
- All posts are public, on one shared board. There are three post types:
  - **Offer:** "I give X, I want Y." The poster locks X.
  - **Wanted request:** "I want Y" with a quantity. It locks nothing and is a request for proposals. What the wanter will give is negotiated in the counter-offer. A wanted request cannot be accepted directly; it is settled by accepting one of its counter-offers.
  - **Counter-offer:** a response to an offer or wanted request. It is itself an offer with a `parent_offer_id` and locks its own side. Counter-offers are one level deep in v1 and cannot themselves be countered.
- A post order locks the offered goods when queued, up to what the player holds; removing or failing the order releases the lock. Posts stay open until cancelled or expired. Default expiry is 7 ticks, configurable by the poster between 1 and 28 ticks.
- `expiryTick` is the last tick in which a post can be accepted. A post made at tick T becomes acceptable at T+1 and expires at the start of `expiryTick + 1`. This keeps one negotiation round to one day.
- All trades are all-or-nothing: no partial fills in v1.
- When a counter-offer is made, the original offer stays open alongside it. Both lock their own goods independently. A counter on a wanted request locks only the counterer's goods; the wanter's side is locked when the wanter accepts.
- Cap: a player may have at most 10 open offers, wanted requests and counter-offers combined in v1.
- **Counter-offer lifecycle:**
  - If the original post is accepted directly, cancelled, or expires, all its counter-offers auto-cancel and release their locked goods.
  - Accepting a counter-offer resolves it as a trade, cancels the original it counters, and cancels all sibling counter-offers. The accepted counter itself is settled, not cancelled by the cascade.
  - A counter-offer is valid only if its parent is still open at the end of the tick in which the counter was posted; otherwise the counter is cancelled and its locks release.
- **Acceptance:**
  - An acceptance is an order. It locks the accepter's side at queue time so the same goods cannot be promised twice. If it fails at resolution, the acceptance's locks release, while locks belonging to the accepter's other open posts remain.
  - Accepting your own post is invalid, and a player cannot counter their own post.
  - A counter-offer can be accepted only by the poster of its parent post.
  - A negotiation is the parent post plus all its counter-offers. The first successful acceptance in queue order settles the negotiation; every later acceptance for that negotiation fails.
  - If the accepter lacks goods or capacity at resolution, the acceptance fails. The post being accepted stays open and keeps its locks, and any additional locks taken by the acceptance release.
  - Capacity checks include locked goods.
- Everything settles at the tick, so one negotiation round takes one day.
- The UI must show free stock (held minus locked) clearly. The server enforces that locked goods cannot be spent, gifted, cooked, contributed or re-offered.
- Trade history is public in the event log and replay.

## 8. Social interaction

- Visitors can look at plots and use the barter board. Trade is board-wide and does not require a visit.
- Gifts transfer goods remotely, check recipient capacity, respect locks, and earn the giver +5 goodwill.
- When a visitor helps with a chore (water, feed or tend, as defined in content), the helper pays the energy, the host gets the benefit, and the helper earns +1 goodwill. A chore can be completed only once per tick; contention is resolved by queue order. A player cannot help on their own plot.
- **Goodwill is cosmetic only** (score, badges, decorations). It is not tradeable or spendable and has no functional effect, so it cannot become a currency.
- Communication is a limited **phrase book**: players choose from a fixed list of phrases defined in content JSON. This needs no moderation, is easy to localise, and supports no free text.

## 9. Seasons, weather and shared goals

- A season is 7 ticks. There are four seasons, so a year is 28 ticks.
- Season rollover is the first step of the tick's world update. Crops that cannot grow in the new season wither; stored goods are unaffected.
- Weather is simple: clear, rain, drought, frost. It is rolled from a seeded RNG each tick.
  - Rain counts as watering for outdoor crops.
  - Drought requires watering and raises failure chance.
  - Frost damages or fails frost-sensitive crops.
  - Clear has no modifier.
  - Exact modifiers live in content JSON, and the weather result appears in the replay.
- Shared goals come in two forms: collective builds funded by everyone's contributed goods, and seasonal festivals with group quotas. The schedule is host-configurable; schedule changes take effect at the next goal. A goal expires at its deadline tick if its quota is not met; the goal phase checks success before expiry.
- Contributions lock when the contribution order is queued and are consumed only if the goal succeeds. If the order is removed, or the goal fails or expires, contribution locks release and the goods remain with their owners. There is no punishment for failure.
- Goal checks run after the player order phase. Rewards unlock for everyone at the start of the next tick, so availability never depends on queue position.
- Success unlocks rewards for everyone: new recipes, crop varieties, building types, and map areas or wild zones.

## 10. Replay

- After each tick, the client replays everything that happened everywhere. Players can replay the most recent tick as many times as they like and follow different locations.
- The server writes the full event log, including complete avatar movement paths. The client only plays it back.
- Players only see the latest tick, but every tick's log is archived on the server.
- Each tick's event header carries a schema version (`v: 1`), world seed, tick number, `generator_version`, `content_version` and `rules_version`. RNG is seeded from these values; the rules use no wall-clock time or unordered iteration.
- A state hash is stored with the event log. Golden-log tests compare both the event sequence and the final state hash.
- Replay logs contain only public game events; credentials and push subscriptions are never written to them.

## 11. Presentation

- 32x32 pixel tiles from free-licensed packs (for example OpenGameArt or Kenney). Keep a credits file and check each pack's licence terms. Every pack must be verified compatible with redistribution before use.
- PixiJS renders the map and replay. Preact builds the panels for orders, market and inventory.
- Desktop-first layout. Mobile browsers can view replays but are not optimised for ordering in v1. Optional music and sound effects.
- A short guided first tick onboards new players.
- Web push notifies players when a tick has resolved. This needs a service worker and VAPID keys. The notification carries the tick number; the client fetches the replay when opened. Push failures are logged and never affect tick resolution. iOS only supports push for installed web apps, so push is best-effort on iOS.

## 12. Architecture

| Area | Decision |
| --- | --- |
| Language | TypeScript end to end, with a shared pure rules package used by server, worker and client |
| Server | One Node API process, plain REST with JSON; clients poll every 5 seconds |
| Database | SQLite via better-sqlite3 with raw SQL, WAL mode, `busy_timeout`, single writer |
| Tick worker | Separate Node process managed by systemd; polls every minute; acquires a global tick lock and resolves each tick in one `BEGIN IMMEDIATE` transaction |
| Live updates | Client polling plus web push on tick completion |
| State storage | Current-state tables plus an append-only archived event log and a per-tick state hash |
| Content | Versioned JSON files validated by a schema (energy costs, recipes, crops, buildings, biomes, phrase book); content version pinned per world and changes apply next tick |
| Client rules | Light checks only (energy, basic validity). The server is authoritative |
| Auth | Invite-only; passkeys plus Discord and GitHub OAuth; no passwords; multiple credentials per player; WebAuthn needs HTTPS and a stable RP ID |
| Push | Web push with VAPID keys and a service worker |
| Backups | Nightly off-site copy (S3-compatible) using SQLite's online backup, with a WAL checkpoint; periodic restore drill |
| Deployment | NixOS on a cheap VPS (flake plus NixOS service module) |
| Testing | Rules unit tests, property tests for invariants, and golden tick logs with state hashes |
| Admin | Config file and database inspection only; no in-game admin UI |

**Threat model (v1):** a modified client can only queue orders it could queue from the genuine UI. Every order is re-validated server-side against current state, energy, capacity, locks, location and offer state. Access is invite-only, which also enforces the player cap. No passwords are stored. OAuth tokens are encrypted at rest in the database, and passkey private keys never leave their authenticators. Infrastructure secrets (session signing keys, OAuth client secrets, the VAPID private key and backup credentials) live in deployment configuration, not the repo. Auth endpoints are rate-limited, session cookies are HttpOnly and SameSite, and mutations are CSRF-protected. The phrase book removes free-text abuse. Off-site backups are encrypted at rest.

## 13. Data model sketch

**Entities:** world (seed, generator_version, content_version, rules_version, current tick, season, next deadline, timezone, deadline time), players, credentials, push subscriptions, regions (id, grid x/y), tiles (region, x, y, type, biome, traits), plots (player, region, site coords), buildings (plot, type, level, construction completion tick, craft queue), crops (plot, tile, type, planted tick, growth, watered, tended, failed), animals (plot, type, count, fed), inventory (plot, item, quantity, locked quantity), orders (player, tick, sequence, type, payload, status, failure reason), ready state (player, tick, ready position), offers and counter-offers (poster, kind, gives, wants, expiry tick, status, parent offer id), wild nodes (region, coords, resource, amount, capacity, regrow rate), goals and contributions, goodwill (player, score), decorations, tick logs (tick, schema version, seed, generator/content/rules versions, state hash), archived events (tick, sequence, version, type, payload) plus avatar paths.

**Order types:** plant, harvest, tend, feed, build, upgrade, craft, travel, help, gift, forage, fish, post offer, post wanted request, cancel offer, accept offer, counter-offer, contribute to goal, place decoration.

**Event types:** order resolved or failed, avatar path, crop grown, failed or withered, weather, blight, animal produced, construction or craft started or completed, trade completed, post created, cancelled or expired, gift, help, goal contribution, progress or completion, season change, node depleted or regrown, player joined.

**Constraints:**
- `locked <= quantity`; one inventory row per plot and item; locked goods count against storage capacity.
- One player per plot and one plot per player.
- At most one ready entry per player per tick; ready positions are unique per tick.
- At most one wild-node claim per player per node per tick.
- Node amount stays between 0 and its capacity.
- Post quantities are positive; expiry is 1-28 ticks; a counter's parent must be open; counter depth is at most one; wanted requests have no locked side; expired posts cannot be accepted; one crop per plot tile.
- Orders are atomic: a failed order cannot change state.
- Every inventory change is recorded in the event log; tests assert inventory conservation including production and consumption.
- Archived events are immutable and have a unique `(tick, sequence)`; one state hash is stored per tick.

## 14. Tick resolution (proposed algorithm)

1. **Acquire.** The worker takes the global tick lock and sets a short-lived `world.resolving` lease in a small, separate transaction. If the lock is unavailable, it exits. It then opens `BEGIN IMMEDIATE` for the resolution transaction.
2. **Freeze.** Load the world, config and content version. Freeze the player roster and ready set. Players joining after this point wait for the next tick.
3. **Seed the RNG.** Seed from `(world_seed, tick, generator_version, content_version, rules_version)`. Do not use wall-clock time or unordered iteration.
4. **World update**, in this order:
   a. Run season rollover if due; wither crops that cannot grow in the new season.
   b. Roll weather for the tick.
   c. Advance crops using watering and tending flags from the previous tick plus weather; roll pests and blight; log growth and failure.
   d. Run animal production from the previous tick's feeding flags, then clear those flags.
   e. Advance in-progress construction and crafting jobs; complete jobs that finish this tick.
   f. Regrow wild nodes up to capacity.
   g. Expire posts whose `expiryTick` has passed; cascade-cancel counter-offers and release locks.
5. **Player order phase.**
   - Order players: ready by ready position, then unready by player ID. Append missed-tick defaults to unready players' queues.
   - For each player, run queued orders in sequence. Batch orders were pre-expanded into per-unit orders.
   - Validate each order against current state (energy, free inventory, capacity, locks, location, building requirements, offer state). Execute it atomically or log a failure with a reason.
   - A failed order costs no energy or goods and releases any locks it took.
   - For forage and fishing, validate travel, energy and free storage, reserve the energy and record the claim; do not apply the yield yet.
6. **Wild claim resolution.** Fix each node's claimant set. Compute `floor(nodeYield / claimantCount)` per claimant and apply shares in queue order, capped by free storage. Overflow stays on the node and is logged as a partial fill.
7. **Goal phase.** Evaluate goal quotas including this tick's contributions. On success, consume contributed goods and mark rewards for the next tick. On failure or expiry, release contribution locks.
8. **Finalize.** Append events in deterministic order: world update, player orders, wild claims, goals. Compute the state hash. Advance the tick, compute the next deadline, and clear per-tick ready and claim flags. Commit.
9. **After commit.** Release the resolving lease and tick lock, then send push notifications. Push failures are logged only.

Steps 2 to 8 run in one database transaction, so a crash leaves the previous tick intact; the resolving lease is cleared after commit or rollback, and a crashed worker's lease expires by timeout. Any exception rolls back the whole transaction; the worker logs it and retries on the next poll. The tick lock and tick number make resolution idempotent. API mutations check the `world.resolving` lease and return 409, and SQLite's writer lock blocks mutations during the transaction. The event log and state hash are written in the same transaction, and replay ordering is part of the recorded contract.

The rules are deterministic. The only wall-clock input is scheduling the next deadline (plus operational auth and session expiry), and the deadline is excluded from the replay state hash. Golden-log tests inject a fixed clock for scheduling.

## 15. Open questions and risks

- **Energy budget and costs, goodwill tuning, phrase book contents, final biome and content lists:** to be defined in content JSON and tuned in playtesting.
- **Art licensing:** verify each pack's licence is compatible with how you publish it before adding it to the repo.
- **Push on iOS:** requires the web app to be installed to the home screen; treat push as best-effort.
- **Player departure:** plots persist forever and are never reclaimed. Decide later whether the host can archive an inactive plot.
- **Wanted-request spam and negotiation depth:** v1 uses one-level counters. Consider deeper negotiation only if the board feels too coarse.
- **Missed-tick defaults and tending:** defaults water, harvest and feed but do not tend. Decide whether tending is optional or add auto-tend before playtesting.
- **Wild depletion:** over-harvesting is a shared-resource pressure, not a targeted action, but it can still feel like griefing. Tune regrowth and depletion warnings.
- **Tick failure handling:** a persistent resolution bug would stall the world. Add host alerting and a safe manual retry path.
- **Zero-share forage:** a valid claim can spend energy for zero units. Consider blocking claims when the expected share is zero or warning in the UI.
- **Travel model:** v1 uses one-way travel with a free return home. Revisit if this makes remote chores too cheap.
- **Replay payload size:** 20 players with full paths may produce large logs. Consider compression or snapshot reconstruction if replay fetches become slow.
- **Season rollover loss:** losing out-of-season crops may feel harsh in a cozy game; tune the warning and withering rules.
- **Account recovery:** if a player loses every linked credential, the host currently has no recovery path. Decide before playtesting.
- **Barter liquidity:** without currency, matching may be slow. Monitor whether the 10-post cap and one-day negotiation cycle are enough.

Resolved in Draft 2: unready-player tie-break, counter-offer cascade, offer cap and default expiry, early-tick deadline rule, world-update-before-orders, wild split formula, missed-tick defaults.

Resolved in Draft 3: roster freeze and mid-tick joins; deadline timezone and minimum gap; batch expansion; travel and avatar location; harvest-before-water defaults; animal and crop timing; two-phase forage split; acceptance locks and one-settlement-per-negotiation; wanted-request semantics; one-level counters; goal evaluation and refund timing; generator, content and rules versioning; worker topology; invite-only auth; passkey secret wording; state hashes.

## 16. Suggested milestones

1. Repo, Nix flake and dev shell, shared rules package skeleton.
2. Rules core (energy, crops, forage split, offers) with golden-log tests.
3. Map generator, database schema and content schema.
4. Tick worker, REST API skeleton and invite-only auth.
5. Vertical slice: plot view, order queue, one resolved tick and replay playback.
6. Barter board and social actions (gifts, help, phrase book).
7. Seasons, weather, shared goals and web push.
8. Content pass (crops, buildings, recipes, phrases) and onboarding.
9. Deployment, backups, restore drill and a friends playtest.
