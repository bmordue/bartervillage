# Barter Village: Implementation Checklist

*Derived from `Barter Village Game Specification.md` (Draft 3, 7 November 2026). The spec remains the source of truth; each task references the section it implements.*

## How to use

- Tick a box only when the task is implemented, tested and merged.
- Milestones follow the suggested order in spec §16; tasks are ordered by dependency within each milestone.
- Add a PR or issue link after a task when helpful.
- Items marked **Decision** are blocked on an open question in spec §15.
- Keep this file updated in the same PR as the work it tracks.

**Out of scope for v1:** currency or coins, competitive actions, free-text chat, mobile-first UI, real-time movement, multiple worlds (spec §3).

## v1 acceptance criteria (spec §3)

- [ ] Tick resolution for 20 players, each with a full day of orders, completes in under 60 seconds on the deployment VPS (p95 over a 28-tick soak test).
- [ ] A new player can complete onboarding, queue a full day of orders and watch the resulting replay in a single 15-minute session.
- [ ] Server is authoritative: a tampered client cannot spend energy or goods it does not have.
- [ ] Tick resolution is atomic: a crash mid-tick leaves no partial state, and the replay log matches the resolved state.
- [ ] Nightly backup restores onto a fresh VPS and passes the golden-log suite.
- [ ] Every inventory change is explained by an event; production and consumption are the only sources and sinks, and golden tests assert this.

## Cross-cutting test infrastructure (spec §12)

- [ ] Rules unit-test harness.
- [ ] Property-test harness for invariants.
- [ ] Golden tick-log harness with fixed-clock injection; compares both the event sequence and the final state hash.
- [ ] Determinism tests: the same seed, tick and versions produce identical events and state hash with no wall-clock time or unordered iteration.
- [ ] API/database integration-test harness.
- [ ] End-to-end harness for onboarding, ordering, tick resolution and replay playback.
- [ ] 28-tick, 20-player soak and performance harness.
- [ ] Inventory-conservation assertion helper used by tick tests.
- [ ] Automated backup and restore-drill test.

## Milestone 1: Repo, Nix flake and shared rules package skeleton (spec §16.1)

- [ ] Initialise a TypeScript workspace with packages for `rules`, `server`, `worker`, `client` and `content`.
- [ ] Enable strict TypeScript, linting and formatting.
- [ ] Add the unit, property and golden-log test runners.
- [ ] Add CI covering lint, type-check, unit tests, property tests and golden logs.
- [ ] Add a Nix flake and dev shell pinning Node and required tooling.
- [ ] Add the MIT or Apache licence and a separate art-asset credits file.
- [ ] Define version identities for rules, content and generator, and include them in every tick header.
- [ ] Create the pure rules package entry point: load state, resolve orders, return events and a state hash.
- [ ] Define shared domain types for world state, players, plots, inventory, orders, events, posts and content, including the complete order-type and event-type enums (spec §13).
- [ ] Add a seeded PRNG shared by map generation and tick resolution.
- [ ] Add canonical JSON serialization and a state-hash utility.
- [ ] Add an injectable clock used only for deadline scheduling.
- [ ] Enforce rules-package boundaries: no I/O, database, network, ambient time or ambient RNG.

## Milestone 2: Rules core with golden-log tests (spec §16.2)

### Orders, ready state and energy

- [ ] Order queue model with player, tick, sequence, type, payload, status and failure reason (spec §13).
- [ ] Implement execution for plant, harvest, tend, feed, build, upgrade, craft, travel, forage, fish and the barter order types (post offer, post wanted request, cancel offer, accept offer and counter-offer), plus place decoration; add help and gift in Milestone 6 and goal contributions in Milestone 7 (spec §13).
- [ ] Emit the event types for order resolution, avatar paths, crops, animals, construction, crafting, wild nodes and barter; add weather, goals, seasons, gifts, help and player-joined events in their milestones (spec §13).
- [ ] Atomic order execution: validate all preconditions, then execute; a failed order logs a reason, spends no energy or goods, releases any locks and does not stop the next order (spec §4.2).
- [ ] Batch orders expanded into per-unit orders at queue time, with each unit atomic and independently failable (spec §4.2).
- [ ] Queue editing before the tick, including removal of orders and release of their locks (spec §4.2).
- [ ] Ready state with monotonic, per-tick unique positions; un-readying allows edits and re-readying goes to the back of the queue (spec §4.2).
- [ ] A player may ready with an empty queue (spec §4.2).
- [ ] Resolution order: ready players by ready position ascending, then unready players by player ID ascending; the same order applies to player-vs-player contention (spec §4.2).
- [ ] Within a player's turn, orders run in queue order (spec §4.2).
- [ ] Daily energy budget from content JSON, refreshed each tick with no carry-over (spec §4.3).
- [ ] Per-action energy costs from content JSON, with actions failing when energy is insufficient (spec §4.3).
- [ ] Travel costs: free within the player's own region, 5 energy per region boundary crossed, diagonal neighbours count as two steps (spec §4.3, §5).
- [ ] Avatars start each tick at their own plot; one-way travel orders move them, and they return home at the end of the tick at no extra cost (spec §4.3, §5).
- [ ] Orders acting on a remote site validate that an earlier travel order in the same queue reached that region (spec §4.2, §4.3).
- [ ] Help energy is paid by the helper; travel is paid by the travel order; the host pays nothing (spec §4.3).
- [ ] Missed-tick defaults appended after explicit orders for unready players: auto-harvest, then auto-water, then auto-feed (spec §4.4).
- [ ] Missed-tick defaults are enabled per player by default, respect energy and capacity, stop when exhausted and log what they did (spec §4.4).
- [ ] Missed-tick defaults never queue building, crafting, trading, gifting or goal contributions (spec §4.4).
- [ ] Default orders are ordinary orders and appear in the replay (spec §4.4).

### Crops and animals

- [ ] Crop lifecycle with planted tick, growth of 1 to 7 ticks, season gating and ripening at the start of tick T+N (spec §6.2).
- [ ] A crop ripens only if it received the required watering and tending during each growth tick and did not fail (spec §6.2).
- [ ] Watering and tending orders at tick T set flags used by the T+1 world update, then reset (spec §6.2).
- [ ] A newly planted crop starts unwatered and untended; later orders in the same queue can water or tend it (spec §6.2).
- [ ] Crop failure per tile from weather, neglect, pests or blight; failure destroys only that tile's crop, leaves stored goods untouched and allows replanting (spec §6.2).
- [ ] Crops that cannot grow in the new season wither at season rollover (spec §6.2, §9).
- [ ] Weather effects on crops: rain counts as watering, drought requires watering and raises failure chance, frost damages or fails frost-sensitive crops, clear has no modifier (spec §9).
- [ ] One crop per plot tile; planting and harvesting respect capacity and inventory rules (spec §13).
- [ ] Animals require daily feeding orders that cost energy; a feed at tick T satisfies the T+1 production check (spec §6.2).
- [ ] An unfed animal skips its production check, is not lost and causes no other effect (spec §6.2).

### Foraging and fishing

- [ ] Wild nodes with resource, amount, capacity and regrowth rate, regrowing each tick up to capacity (spec §5, §14.4).
- [ ] Wild zones can be depleted by over-harvesting; shared water zones support fishing (spec §5).
- [ ] Claim validation: node has at least one unit, player is in the node's region, player has energy and some free storage (spec §6.2).
- [ ] A valid claim reserves energy and records the claim during the player's turn without applying yield yet (spec §6.2, §4.3).
- [ ] At most one claim per player per node per tick (spec §6.2, §13).
- [ ] Claimant sets are fixed after all player turns; invalid claims are excluded (spec §6.2).
- [ ] Each claimant receives `floor(nodeYield / claimantCount)` units; the remainder stays on the node, and a zero share still spends the reserved energy (spec §6.2).
- [ ] Shares apply in queue order, capped by free storage; overflow stays on the node and is logged as a partial fill (spec §6.2).
- [ ] Dock fishing is private with no split; shared-water fishing uses the same claim-and-split rule as foraging (spec §6.2).
- [ ] Docks are biome-locked to riverside or coast sites (spec §6.1).

### Buildings, storage and crafting

- [ ] Building types with levels and biome locks (spec §6.1).
- [ ] Upgrades unlock recipes, raise capacity or improve speed according to content (spec §6.1).
- [ ] Upgrades cost goods, energy and waiting ticks; an upgrade ordered at tick T with duration N completes at the start of tick T+N, before orders (spec §6.1).
- [ ] At most one construction or upgrade per building at a time; a second upgrade order fails until the first completes (spec §6.1).
- [ ] Construction inputs lock when the order is queued and are consumed when work starts (spec §6.1).
- [ ] Storage capacity per storage building, raised by upgrades; locked goods occupy capacity and free stock is held minus locked (spec §6.1).
- [ ] Inventory uses plain stackable goods with no quality tiers and no spoilage (spec §6.1).
- [ ] Instant recipes produce during the tick's order phase (spec §6.2).
- [ ] Timed recipes enter a per-building FIFO queue when the order resolves; an idle building starts immediately and queued jobs start when the previous job completes (spec §6.2).
- [ ] A job starting at tick S with duration N completes at the start of tick S+N, with one job per building at a time (spec §6.2).
- [ ] Craft inputs lock when the order is queued and are consumed when the job starts; removing the order before the tick releases the lock, and resolved jobs cannot be cancelled (spec §6.2).
- [ ] Recipe discovery is gated by building level and shared-goal unlocks; unlocks take effect at the start of the next tick after the goal succeeds (spec §6.2).
- [ ] Decorations are cosmetic, placed on a plot, crafted or earned via goodwill or shared goals, and do not affect production (spec §6.2).

### Barter

- [ ] Post types: offer, wanted request and counter-offer, with gives, wants, quantity, expiry, status and parent offer ID (spec §7, §13).
- [ ] Offers lock the offered goods at queue time; removing or failing the order releases the lock (spec §7).
- [ ] Wanted requests lock nothing, request proposals and cannot be accepted directly; they settle by accepting a counter-offer (spec §7).
- [ ] Counter-offers lock only the counterer's side; the wanter's side locks when the wanter accepts (spec §7).
- [ ] Posting a counter-offer leaves the original post open; the original and the counter lock their own goods independently (spec §7).
- [ ] Counters are one level deep and cannot themselves be countered (spec §7).
- [ ] Expiry semantics: a post made at tick T is acceptable from T+1 and expires at the start of `expiryTick + 1`; expiry is configurable from 1 to 28 ticks, default 7 (spec §7).
- [ ] Posts stay open until cancelled or expired (spec §7).
- [ ] A player may have at most 10 open offers, wanted requests and counter-offers combined (spec §7).
- [ ] Direct acceptance, cancellation or expiry of a parent auto-cancels all its counter-offers and releases their locks (spec §7).
- [ ] Accepting a counter-offer settles it as a trade, cancels the parent and cancels all sibling counters, without cancelling the accepted counter itself (spec §7).
- [ ] A counter-offer is valid only if its parent is still open at the end of the tick in which the counter was posted; otherwise the counter is cancelled and its locks release (spec §7).
- [ ] Acceptance is an order that locks the accepter's side at queue time (spec §7).
- [ ] A failed acceptance releases only its own locks; locks belonging to the accepter's other open posts remain (spec §7).
- [ ] Accepting your own post is invalid, and a player cannot counter their own post (spec §7).
- [ ] A counter-offer can be accepted only by the poster of its parent post (spec §7).
- [ ] A negotiation is the parent post plus all counters; the first successful acceptance in queue order settles it, and every later acceptance for that negotiation fails (spec §7).
- [ ] If the accepter lacks goods or capacity at resolution, the acceptance fails; the accepted post stays open and keeps its locks (spec §7).
- [ ] Capacity checks include locked goods (spec §7).
- [ ] All trades are all-or-nothing with no partial fills (spec §7).
- [ ] Locked goods cannot be spent, gifted, cooked, contributed or re-offered; free stock is exposed to the UI (spec §7, §13).
- [ ] Trades are board-wide and require no travel (spec §7).

### Invariants and property tests

- [ ] `locked <= quantity` in every state transition; one inventory row per plot and item (spec §13).
- [ ] One player per plot and one plot per player; plots persist forever and are never reclaimed (spec §13, §4.4).
- [ ] At most one ready entry per player per tick; ready positions are unique per tick (spec §13).
- [ ] At most one wild-node claim per player per node per tick (spec §13).
- [ ] Node amount stays between 0 and its capacity (spec §13).
- [ ] Post quantities are positive; expiry is 1 to 28 ticks; a counter's parent must be open; counter depth is at most one; wanted requests have no locked side; expired posts cannot be accepted; one crop per plot tile (spec §13).
- [ ] A failed order cannot change state (spec §13).
- [ ] Every inventory change is recorded in the event log; conservation tests cover production and consumption (spec §13).
- [ ] Archived events are immutable with a unique `(tick, sequence)`; one state hash is stored per tick (spec §13).

## Milestone 3: Map generator, database schema and content schema (spec §16.3)

- [ ] SQLite schema and migrations for all entities in spec §13: world, players, credentials, push subscriptions, regions, tiles, plots, buildings, crops, animals, inventory, orders, ready state, offers, wild nodes, goals, contributions, goodwill, decorations, tick logs and archived events with avatar paths.
- [ ] Enforce the spec §13 constraints at the schema and rules layers.
- [ ] Ensure the schema, content and UI contain no currency or coin concept (spec §3, §7).
- [ ] Configure SQLite WAL mode, `busy_timeout` and a single-writer model using raw SQL.
- [ ] Add the database access layer without an ORM.
- [ ] Deterministic map generator using the world seed and pinned `generator_version` (spec §5).
- [ ] Persist the generated map explicitly; existing plots never move and existing regions never regenerate (spec §5).
- [ ] Append new regions in deterministic order as players join; append a region when no open site remains (spec §5).
- [ ] New players choose from currently open sites; site claims are transactional and simultaneous claims resolve first-write-wins (spec §5).
- [ ] Every new plot starts with a home, a field and a storehouse (spec §6.1).
- [ ] Region geometry with stable ID, grid coordinates, per-plot tile coordinates, and travel cost derived from Manhattan distance (spec §5).
- [ ] World-generation constants for region size, plot count and the approximately 12x12 plot size (spec §5, §6.1).
- [ ] Sites carry biome and traits (soil, water, light) (spec §5).
- [ ] Regions contain player plots, world-owned commons and wild zones; shared buildings are funded only by goals (spec §5).
- [ ] Wild nodes in commons and wild zones are public and shared; shared water zones exist for fishing (spec §5).
- [ ] Versioned content JSON with a validator for energy costs, recipes, crops, buildings, biomes, weather modifiers, goals and the phrase book (spec §12).
- [ ] Pin a content version per world; content changes apply at the next tick (spec §12).
- [ ] Current-state tables plus an append-only archived event log and a per-tick state hash (spec §12).
- [ ] Generator tests: the same seed and version produce the same map; appending regions never changes existing regions or plots.
- [ ] Migration tests from an empty database and indexes for tick, player and board queries.

## Milestone 4: Tick worker, REST API and invite-only auth (spec §16.4)

### Tick worker

- [ ] Separate Node worker process managed by systemd (spec §12, §14).
- [ ] Poll every minute and acquire the global tick lock; exit without resolving when the lock is unavailable (spec §4.1, §14.1).
- [ ] Set a short-lived `world.resolving` lease in a separate transaction, and clear it after commit or rollback; a crashed worker's lease expires by timeout (spec §14.1, §14.9).
- [ ] Open `BEGIN IMMEDIATE` for the resolution transaction (spec §14.1).
- [ ] Run resolution steps 2 to 8 in one database transaction, so a crash leaves the previous tick intact (spec §14, §14.9).
- [ ] Freeze the world, config and content version, plus the player roster and ready set; players joining after this point wait for the next tick (spec §14.2, §4.1).
- [ ] Seed the RNG from `(world_seed, tick, generator_version, content_version, rules_version)` with no wall-clock time or unordered iteration (spec §14.3).
- [ ] World update step 1: run season rollover when due and wither crops that cannot grow in the new season (spec §14.4a, §9).
- [ ] World update step 2: roll weather for the tick (spec §14.4b, §9).
- [ ] World update step 3: advance crops using previous-tick watering and tending flags plus weather, roll pests and blight, and log growth and failure (spec §14.4c).
- [ ] World update step 4: run animal production from the previous tick's feeding flags, then clear those flags (spec §14.4d).
- [ ] World update step 5: advance in-progress construction and crafting jobs and complete jobs that finish this tick (spec §14.4e).
- [ ] World update step 6: regrow wild nodes up to capacity (spec §14.4f).
- [ ] World update step 7: expire posts, cascade-cancel counter-offers and release locks (spec §14.4g).
- [ ] Player order phase: order players, append missed-tick defaults, run orders in sequence, validate atomically and log failures (spec §14.5).
- [ ] Wild claim phase: fix claimant sets, compute shares, apply them in queue order capped by free storage and log partial fills (spec §14.6).
- [ ] Goal phase: evaluate quotas including this tick's contributions, consume goods on success, mark next-tick rewards, and release locks on failure or expiry (spec §14.7).
- [ ] Finalize: append events in deterministic order (world update, player orders, wild claims, goals), compute the state hash, advance the tick, compute the next deadline and clear per-tick ready and claim flags (spec §14.8).
- [ ] Treat event ordering as part of the recorded contract; it must be deterministic (spec §14.9).
- [ ] Write the tick header with `v: 1`, world seed, tick number, `generator_version`, `content_version` and `rules_version` (spec §10).
- [ ] Record complete avatar movement paths, including return home, in the event log (spec §5, §10).
- [ ] Commit the event log and state hash in the same transaction (spec §14.8, §14.9).
- [ ] After commit, release the resolving lease and tick lock, then send push notifications; log push failures only (spec §14.9, §11).
- [ ] Crash safety: any exception rolls back the whole transaction, the worker logs it and retries on the next poll (spec §14.9).
- [ ] Make resolution idempotent through the tick lock and tick number (spec §14.9).
- [ ] Deadline scheduling from a local time and IANA timezone; the next deadline is the next occurrence strictly after resolution and at least `min_tick_gap` later, default 60 minutes (spec §4.1).
- [ ] Deadline changes take effect at the next tick (spec §4.1).
- [ ] Tick trigger when every player is ready or at the deadline; start within 60 seconds of the trigger (spec §4.1).
- [ ] Exclude mid-tick joins from the current tick (spec §4.1).
- [ ] Reject mutations with a "tick in progress" response while the resolving lease is held (spec §4.1, §14.9).
- [ ] Keep wall-clock time out of the rules; use it only for scheduling the next deadline, and exclude the deadline from the replay state hash (spec §14).
- [ ] Add host alerting and a safe manual retry path for persistent resolution failures (spec §15).
- [ ] Benchmark 20 players with full order queues over a 28-tick soak; p95 under 60 seconds (spec §3).

### REST API

- [ ] One Node API process serving plain REST with JSON; clients poll every 5 seconds (spec §12).
- [ ] Endpoints for auth and sessions, world state, player plot, inventory, order queue, ready state, barter board, posts, latest replay, push subscription and onboarding site claim.
- [ ] Re-validate every order server-side against current state: energy, free inventory, capacity, locks, location, building requirements and offer state (spec §12, §14.5).
- [ ] Keep client-side rules checks light and non-authoritative (spec §12).
- [ ] Return 409 for mutations while the resolving lease is held; rely on SQLite's writer lock to block mutations during the transaction (spec §14.9).
- [ ] Enforce invite-only access and the 20-player cap through invites (spec §3, §12).
- [ ] Protect mutations with CSRF protection; use HttpOnly and SameSite session cookies (spec §12).
- [ ] Rate-limit auth endpoints (spec §12).
- [ ] Encrypt OAuth tokens at rest; never store passwords (spec §12).
- [ ] Keep infrastructure secrets in deployment configuration, not the repository (spec §12).

### Auth and onboarding

- [ ] Passkey (WebAuthn) registration and login with HTTPS and a stable RP ID; private keys never leave authenticators (spec §12).
- [ ] Discord OAuth login (spec §12).
- [ ] GitHub OAuth login (spec §12).
- [ ] Support multiple credentials per player, including account linking (spec §12).
- [ ] Invite issuance and redemption flow (spec §3, §12).
- [ ] Session creation, expiry and logout.
- [ ] Choose and implement an account-recovery path for lost credentials (spec §15).
- [ ] Transactional site claim during onboarding, with first-write-wins for simultaneous claims (spec §5).

## Milestone 5: Vertical slice with plot view, order queue, one tick and replay (spec §16.5)

### Client shell

- [ ] Preact client app with a desktop-first layout (spec §11).
- [ ] PixiJS renderer for the map and replay using 32x32 pixel tiles (spec §11).
- [ ] Panels for orders, barter board and inventory (spec §11).
- [ ] Display energy, tick, season, weather, deadline and ready state.
- [ ] Poll the server every 5 seconds (spec §12).
- [ ] Handle the 409 tick-in-progress response gracefully.
- [ ] Keep replay viewing usable on mobile browsers; mobile-first ordering is not required (spec §3).
- [ ] Read-only view of other players' plots (spec §8).

### Plot and order queue

- [ ] Plot view showing the home, field and storehouse (spec §6.1).
- [ ] Order queue UI for adding, removing and reordering orders before the tick (spec §4.2).
- [ ] Batch order selection ("fill this row or area") with upfront expansion into per-unit orders (spec §4.2, §4.3).
- [ ] Ready toggle with clear indication that the queue is fixed after the tick starts.
- [ ] Inventory panel showing held, locked and free stock plus capacity (spec §7).
- [ ] Display order failure reasons after resolution (spec §4.2).
- [ ] Client-side light validation only, with the server remaining authoritative (spec §12).

### Replay

- [ ] Fetch the latest tick replay and play back events in recorded order (spec §10).
- [ ] Render complete avatar movement paths and allow following different locations (spec §5, §10).
- [ ] Allow unlimited replays of the latest tick; players only see the latest tick while all logs are archived server-side (spec §10).
- [ ] Handle the `v: 1` event header and version metadata (spec §10).
- [ ] Ensure replay logs contain only public game events, never credentials or push subscriptions (spec §10).

## Milestone 6: Barter board and social actions (spec §16.6)

- [ ] Public barter board listing offers, wanted requests and counter-offers with goods, quantities, expiry and free stock (spec §7).
- [ ] Create offer and wanted-request flows, including lock and expiry controls (spec §7).
- [ ] Counter-offer flow with parent-post context and the one-level limit (spec §7).
- [ ] Cancel post flow that releases locks (spec §7).
- [ ] Accept offer and accept counter-offer flows with clear validation and failure messaging (spec §7).
- [ ] Show the negotiation cascade: parent, siblings and settled counter (spec §7).
- [ ] Enforce and surface the 10-open-post cap (spec §7).
- [ ] Gift flow: remote transfer, recipient capacity check, lock enforcement and +5 goodwill to the giver (spec §8).
- [ ] Help flow: water, feed or tend on another player's plot; helper pays energy and earns +1 goodwill; host receives the benefit (spec §8).
- [ ] Restrict each chore to once per tick and resolve contention by queue order (spec §8).
- [ ] Block helping on your own plot (spec §8).
- [ ] Goodwill score and badges as cosmetic only, with no tradeable, spendable or functional effect (spec §8).
- [ ] Phrase book UI using a fixed content-defined list with no free text (spec §8).
- [ ] Show public trade history through the event log and replay (spec §7).

## Milestone 7: Seasons, weather, shared goals and web push (spec §16.7)

- [ ] Season length of 7 ticks, four seasons and a 28-tick year (spec §9).
- [ ] Season rollover as the first world-update step, including withering invalid crops and leaving stored goods unaffected (spec §9).
- [ ] Seeded weather roll each tick for clear, rain, drought and frost (spec §9).
- [ ] Apply weather modifiers from content JSON and log the weather result in the replay (spec §9).
- [ ] Shared goals: collective builds funded by contributed goods and seasonal festivals with group quotas (spec §9).
- [ ] Host-configurable goal schedule; schedule changes take effect at the next goal (spec §9).
- [ ] Goal contributions lock at queue time and are consumed only if the goal succeeds (spec §9).
- [ ] Contribution locks release when an order is removed or the goal fails or expires, with goods staying with their owners (spec §9).
- [ ] Goal checks run after the player order phase and check success before expiry (spec §9).
- [ ] Goal rewards unlock for everyone at the start of the next tick (spec §9).
- [ ] Rewards can unlock recipes, crop varieties, building types, map areas and wild zones (spec §9).
- [ ] Web push with VAPID keys, a service worker and stored subscriptions (spec §11, §12).
- [ ] Notify players with the tick number on resolution; the client fetches the replay when opened (spec §11).
- [ ] Log push failures without affecting tick resolution; treat iOS push as best-effort (spec §11).

## Milestone 8: Content pass and onboarding (spec §16.8)

- [ ] Final biome and trait lists in content JSON (spec §5).
- [ ] Approximately 15 crops with growth times of 1 to 7 ticks and season rules (spec §6.2).
- [ ] Approximately 8 building types, including biome-locked buildings such as the dock, with levels, costs, capacities and recipe unlocks (spec §6.1).
- [ ] Approximately 40 cooking, baking and crafting recipes (wood, metal, textiles) with inputs, outputs, durations and instant or timed behaviour (spec §6.2).
- [ ] Animal types, wild nodes, shared water zones and forage/fishing yields (spec §6.2).
- [ ] Default energy budget (100), travel cost (5 per boundary), goodwill awards (+5 gift, +1 help), weather modifiers and goal schedules (spec §4.3, §8, §9).
- [ ] Phrase book contents (spec §8).
- [ ] Content schema validation in CI and a pinned content version (spec §12).
- [ ] Playtesting tuning pass for energy costs, goodwill and barter liquidity (spec §15).
- [ ] Source 32x32 pixel art packs, verify each pack's licence permits redistribution and record credits (spec §11).
- [ ] Guided first tick for new players (spec §11).
- [ ] Keep phrase strings localisation-ready (spec §8).

## Milestone 9: Deployment, backups, restore drill and friends playtest (spec §16.9)

- [ ] Nix flake package and NixOS service module for the API and worker (spec §12).
- [ ] Deploy to a cheap VPS with HTTPS and a stable WebAuthn RP ID (spec §12).
- [ ] Keep session keys, OAuth secrets, the VAPID private key and backup credentials in deployment configuration (spec §12).
- [ ] Run the worker under systemd (spec §12).
- [ ] Nightly encrypted off-site backup to S3-compatible storage using SQLite's online backup with a WAL checkpoint (spec §12).
- [ ] Restore the nightly backup onto a fresh VPS and pass the golden-log suite (spec §3).
- [ ] Run the 28-tick, 20-player soak and record the p95 tick-resolution time (spec §3).
- [ ] Verify a tampered client cannot spend energy or goods it does not have (spec §3).
- [ ] Verify a crash mid-tick leaves no partial state and the replay log matches the resolved state (spec §3).
- [ ] Document admin operations using configuration and database inspection only, with no in-game admin UI (spec §12).
- [ ] Add host alerting and a manual retry runbook for stalled ticks (spec §15).
- [ ] Run a friends playtest at the 20-player cap and collect tuning feedback (spec §16.9).
- [ ] Revisit the decisions in spec §15 before and after the playtest.

## Decisions to close (spec §15)

- [ ] **Decision:** final energy budget and per-action costs (spec §4.3, §15).
- [ ] **Decision:** goodwill tuning (spec §8, §15).
- [ ] **Decision:** phrase book contents (spec §8, §15).
- [ ] **Decision:** final biome and content lists (spec §5, §15).
- [ ] **Decision:** whether missed-tick defaults include tending (spec §4.4, §15).
- [ ] **Decision:** zero-share forage handling, either block the claim or warn in the UI (spec §15).
- [ ] **Decision:** keep one-way travel with a free return home or revise it (spec §15).
- [ ] **Decision:** wild depletion tuning and depletion warnings (spec §15).
- [ ] **Decision:** tick-failure alerting and safe manual retry path (spec §15).
- [ ] **Decision:** replay payload size strategy, including compression or snapshot reconstruction (spec §15).
- [ ] **Decision:** season rollover loss tuning and withering warnings (spec §15).
- [ ] **Decision:** account recovery when every linked credential is lost (spec §15).
- [ ] **Decision:** barter liquidity, including the 10-post cap and one-day negotiation cycle (spec §15).
- [ ] **Decision:** player departure and inactive-plot archiving policy (spec §15).
- [ ] **Decision:** iOS push expectations, treated as best-effort (spec §11, §15).
- [ ] **Decision:** verify art-pack licensing before adding assets (spec §11, §15).
- [ ] **Decision:** deeper negotiation only if the one-level board feels too coarse after playtesting (spec §15).
