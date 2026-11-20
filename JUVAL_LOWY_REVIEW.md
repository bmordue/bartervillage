# Architecture Review: Barter Village

## Review lens

This review evaluates the project from the architectural perspective of **Juval Löwy**: explicit business-aligned boundaries, autonomous components, contract-first integration, deterministic behavior, and systemic qualities as first-class requirements.

## Executive assessment

Barter Village has unusually strong architectural intent for a small project. The specification and implementation clearly identify the most important subsystem: deterministic tick resolution. The repository also shows good judgment by separating pure game rules, HTTP transport, persistence, and scheduled execution, and by making state hashes and golden logs part of the design.

The main concern is not lack of separation but **inconsistent implementation of boundaries**. The REST module is a large transport/application monolith, and the persistence layer reconstructs and rewrites nearly every domain entity. Several rules are also split across `types.ts`, handler modules, server-side validation, and database repositories. This is workable at the project's current scale, but it will become expensive as the system grows.

Overall: **promising architecture, strong correctness foundation, significant decomposition and boundary-work remains**.

## Architectural strengths

### 1. The tick engine is the right principal subsystem

The central responsibility is well identified in `packages/rules/src/engine.ts`: refresh energy, roll or advance state, order players, execute orders, resolve shared claims and goals, increment the tick, and derive a deterministic state hash. `resolveTick()` creates a cloned state and has no ambient-time or randomness dependence in normal use.

This is the correct architectural center. Tick resolution is a business engine rather than a thin orchestration wrapper. It owns policy, deterministic sequencing, and replay evidence. It does not belong inside the HTTP API or the worker, and the project keeps it outside both.

### 2. Pure rules are separated from infrastructure

`packages/rules` defines shared domain types and pure game behavior, including weather, seasons, crops, barter, locks, goals, inventory, and wild claims. The server and worker consume these definitions instead of maintaining a separate implementation of the game.

This separation gives the project strong leverage:

- Unit and property tests can exercise the rules without HTTP or SQLite.
- Golden tick tests can verify event sequences and state hashes.
- Client-side checks can share domain concepts, while remaining advisory.
- Server-side validation can dry-run real handlers against a cloned state.

This is consistent with IDesign's engine/manager concept: `resolveTick()` is a policy engine, while HTTP and scheduling components manage external interaction.

### 3. Determinism is explicit rather than incidental

RNG seeding is derived from world, tick, generator, content, and rules versions. Event sequence and state hash are first-class outputs. The engine explicitly strips scheduling fields from `hashableState()`, so deadline changes do not corrupt replay identity.

This is excellent systemic-quality design. It protects against nondeterministic iteration, makes regressions diagnorable, and provides a natural audit mechanism.

### 4. Transactions protect the business invariant

The worker acquires a global lock and resolving lease, starts `BEGIN IMMEDIATE`, invokes resolution, and rolls back on failure. The lease and lock are released in `finally`, and notification work occurs only after commit.

This is an appropriate fault boundary. It treats a tick as an atomic business operation rather than a collection of independent database writes.

### 5. Server-side authority is taken seriously

`validateOrderServerSide()` checks energy, buildings, inventory locks, location, offers, and storage. It also executes a real handler against a cloned world state. This is much stronger than relying on TypeScript types or a thin request parser.

The mutation guard rejects writes during resolution. The API also performs queue validation and supports atomic batch insertion. These choices align with a hostile-client threat model.

### 6. Verification is comprehensive in scope

The CI workflow runs content validation, secret detection, linting, formatting, type checking, unit tests, property tests, and golden-log tests. The test tree also includes determinism, conservation, invariants, soak, migration, and tick-failure coverage.

This is strong evidence that the project treats systemic qualities as executable requirements.

## Findings requiring action

### Blocking concern: the API routes are too large and mix multiple responsibilities

`packages/server/src/api.ts` is approximately 950 lines and combines route dispatch, JSON transport, authentication assembly, world reads, plot reads, inventory, barter, replay, push subscriptions, onboarding, queue mutation, retries, and rate-limit wrapping.

This is not a well-contained subsystem boundary. Juwal Löwy would ask whether this component is “sized for one business value” and whether it exposes stable contracts. `api.ts` currently exposes all of that in a single module and reaches directly into SQLite on behalf of many use cases.

**Recommendation:** split the API into managers corresponding to business capabilities:

- World/status manager
- Player/onboarding manager
- Plot and inventory manager
- Order queue manager
- Barter manager
- Replay manager
- Push subscription manager
- Tick administration/retry manager
- Authentication/session boundary

Keep each manager behind typed request and result contracts. The HTTP router should translate protocol concerns but should not implement game or persistence policy.

### Blocking concern: domain validation is distributed rather than owned

There are at least three domain-validation surfaces:

- Rules handlers in `packages/rules/src/handlers.ts` and feature modules
- `validateOrderServerSide()` in `packages/server/src/orderValidation.ts`
- Database schemas and repositories in `packages/server/src/db` 

Some duplication is defensive and appropriate. However, “at queue time” and “at resolution time” validation should be separate contract stages with explicitly named responsibilities. Otherwise future order types will inevitably drift between pre-validation and execution.

**Recommendation:** define one canonical order contract for queue validation and resolution context. Queue validation should deliberately provide a user-facing outcome, but resolution execution should remain the final authority. Explicitly document which checks are queue-time checks, which are resolution-time checks, and which are invariant checks.

### Blocking concern: persistence is a second rules engine

`stateRepository.ts` loads and saves almost the entire world model, and does so with a high degree of custom SQL and object reconstruction. The repository does a substantial amount of state orchestration:

- Full table loads
- Table replacement
- Parent-first offer insertion
- Unlock-table synchronization
- Offer cycle detection
- JSON conversion

This is not inherently wrong, but it increases the number of places that understand world invariants. A Löwy-style architecture would prefer a smaller persistence contract with transaction snapshots and explicit save semantics.

**Recommendation:** expose the persistence package as a world snapshot repository with only a few operations:

- Load snapshot
- Begin world transaction
- Save resolved tick snapshot
- Archive replay
- Load public projections

Keep SQL foreign-key and serialization details inside that subsystem. Do not expose `WorldState` mutation to arbitrary API modules.

### High concern: public API authorization is inconsistent

Most game routes identify players by URL parameters and only some routes derive identity from a session cookie. Authentication functionality exists for passkeys, Discord, GitHub, sessions, CSRF, and credential management, but the game APIs in `buildApiRoutes()` do not consistently use `loadRequestPlayerId()`.

This is a systemic security boundary problem, not merely an authentication implementation detail. A caller should not be able to address arbitrary player IDs merely by choosing a URL path or query parameter.

**Recommendation:** make authentication a mandatory middleware contract for player mutation and player-data routes. Use the session-derived player ID as the identity, not a client-supplied `playerId`. Reserve explicit player IDs for administrative or replay projections that have an authenticated authorization reason.

### High concern: batch order validation can diverge from execution

The batch endpoint validates every order against the same original `WorldState`, rather than a sequential dry run of the batch. If order A creates a lock or consumes stock that order B depends on, queue-time behavior may differ from resolution behavior.

**Recommendation:** implement batch validation as one sequential transaction in memory: validate order one, apply its queue-time state effects, validate the next, and only persist the batch if the complete batch is valid. Alternatively, explicitly require independent order validation and document that cross-order effects are resolution-only.

### High concern: the replay API hard-codes version metadata

`GET /replay/latest` hard-codes `worldSeed: "seed"`, `generatorVersion: "gen-1"`, `contentVersion: "content-1"`, and `rulesVersion: "1.0.0"` instead of reading metadata from the stored tick log or world.

This directly weakens replay determinism and version provenance. It is a concrete mismatch between the specification and implementation.

**Recommendation:** store and return an actual `TickHeader` for each replay, including seed and all three version values. Reject replay reads if no matching archived header exists.

### High concern: service boundaries are not fully autonomous

The worker imports server package internals for database, lease, and resolution operations. The server and worker share SQLite and concrete repository implementations rather than a narrowly defined tick contract. The API also imports content directly for projections and validation.

The result is a modular monolith: deployable separately, but less independently evolvable than its process boundaries imply.

**Recommendation:** define a package boundary such as `@bartervillage/tick` or `tick-service` containing:

- Resolution input
- Resolution output
- Replay header
- Lease/lock contract
- Tick failure reporting

The worker should depend on that contract; it should not reach through `@bartervillage/server` into arbitrary database behavior.

### Medium concern: client identity is currently query-based

`packages/client/src/main.tsx` obtains the player ID from `?player=p1`. This is useful for testing, but it is not an authorization identity and could become production code unintentionally.

**Recommendation:** remove player selection from the normal client data flow. Select the authenticated player from the session API, and retain a test-only fixture mechanism behind environment or test configuration.

### Medium concern: `POST /site` is not a complete onboarding operation

The specification calls for transactional site selection and a first-write-wins claim. The current route appears to locate a plot, then update `player_id` in a separate statement. There is no clear claim transaction, uniqueness check, or invite/session involvement in the route excerpt.

**Recommendation:** make onboarding one atomic use case: validate invite, validate session or registration state, select an open site, claim it, create or link the player, and persist initial inventory/buildings in one transaction. Expose a typed onboarding result rather than a generic `POST /site` route.

### Medium concern: operational recovery is only partially complete

The worker tracks consecutive failures and has a manual retry endpoint, but the project should define host-visible failure conditions beyond structured logs. The specification also mentions nightlies, restore drills, and alerting that are not fully represented in the architecture.

**Recommendation:** introduce a durable operational contract that records:

- Failed tick and attempt count
- Resolution lease owner and expiry
- Last successful tick
- State hash
- Manual retry actor and result
- Backup and restore verification status

The host should receive both metrics and actionable alerts rather than relying on log text.

## Suggested target shape

A more Löwy-aligned decomposition would be:

```text
packages/
  domain/              Shared types and pure game policies
  tick-engine/         Deterministic tick orchestration and replay generation
  world-store/         SQLite snapshot, event, and metadata contracts
  account/             Invites, sessions, credentials, provider adapters
  api/                 Protocol and route managers
  worker/              Scheduling and lock orchestration
  client/              Preact UI and replay playback
```

The key responsibility split should be:

- **Game engine:** business rules and replay output
- **World repository:** atomic snapshot and persistence
- **Account service:** identity and invite policy
- **API managers:** use-case orchestration and transport translation
- **Worker:** scheduling and operational fault handling
- **Client:** presentation and queue construction

No component should reach across these boundaries merely for convenience.

## Priority sequence

1. Add session-derived player identity to every game mutation and player-data route.
2. Replace replay hard-coded metadata with persisted `TickHeader` values.
3. Introduce typed API manager boundaries and split `api.ts`.
4. Replace direct cross-package database use in the worker with a tick contract.
5. Clarify queue-time versus resolution-time validation and implement sequential batch validation.
6. Implement transactional onboarding/site claiming.
7. Separate world snapshot persistence from public API projections.
8. Add durable operational health and recovery reporting.

## Bottom line

Barter Village's architecture already contains the difficult ideas that should determine the project: a deterministic rules engine, atomic tick resolution, replay hashes, inventory conservation, and server-authoritative validation. These are the right choices.

The current implementation is a strong modular monolith. The next architectural step is to make those modules real: separate API managers, a narrow tick contract, repository-owned persistence, authenticated player identity, and persisted replay provenance. If those boundaries are established before content and UI expansion continue, the project will scale far better without sacrificing its excellent deterministic core.
