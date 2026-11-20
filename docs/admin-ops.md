# Barter Village — Admin operations (M9.10)

> **No in-game admin UI.** All operations use configuration files, environment files and
> direct database inspection. Never add a privileged admin account or an in-game panel.

## Configuration

All deployment-time settings live in the NixOS module (`flake.nix`). The most common
overrides are:

| Option | Purpose |
|--------|---------|
| `services.barter-village.enable` | Enables API + worker services. |
| `services.barter-village.package` | The `barter-village` package derivation. |
| `services.barter-village.dataDir` | Directory holding `barter-village.sqlite` and WAL files (default `/var/lib/barter-village`). |
| `services.barter-village.environmentFile` | Optional systemd environment file for **secrets** (see below). |
| `services.barter-village.rpID` | WebAuthn relying-party ID (the site's domain). |
| `services.barter-village.origin` | Public HTTPS origin clients use for WebAuthn. |
| `services.barter-village.worker.pollIntervalMs` | Tick worker polling cadence. |
| `services.barter-village.backup.enable` | Enable nightly encrypted backup + timer. |
| `services.barter-village.backup.calendar` | systemd `OnCalendar` expression (default `*-*-* 03:00:00`). |
| `services.barter-village.rpID` | Must match the domain used in the reverse proxy. |
| `services.barter-village.origin` | Must use `https://` in production (enforced by passkey code). |

## VPS Deployment (M9.02)

A dedicated deployment guide is available in `docs/deploy-vps.md`. Key steps:

1. Provision a VPS with a static public IP and a registered domain name.
2. Ensure DNS A/AAAA records point to the VPS's IP address.
3. Set the NixOS module options: `services.barter-village.rpID = "<domain>"` and `services.barter-village.origin = "https://<domain>:443"` (or via environment file `BARTER_ORIGIN=https://<domain>:3000`).
4. Run `caddy validate && caddy run` to start Caddy with automatic TLS via Let's Encrypt.
5. Verify the API is accessible at `https://<domain>:443` and WebAuthn passkey registration works.

See `docs/deploy-vps.md` for the complete step-by-step deployment walkthrough.

## Secrets (environment file)

The `environmentFile` (if provided) must contain **only** the following variables.
It is loaded by both the API and the worker via `EnvironmentFile=` in systemd.
**Never** commit this file to git.

| Variable | Source | Notes |
|----------|--------|-------|
| `BARTER_CREDENTIAL_KEY` | `openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '='` | AES-256-GCM key for encrypting stored credentials. |
| `BARTER_DISCORD_CLIENT_ID`, `BARTER_DISCORD_CLIENT_SECRET` | Discord Developer Portal | Optional; leave unset to disable Discord OAuth. |
| `BARTER_GITHUB_CLIENT_ID`, `BARTER_GITHUB_CLIENT_SECRET` | GitHub OAuth App | Optional; leave unset to disable GitHub OAuth. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` | Web push (M7.12). |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Push contact. |
| `BACKUP_ENCRYPTION_PASSPHRASE` | high-entropy passphrase | AES-256-GCM passphrase for nightly backup encryption. |
| `BACKUP_WORK_DIR` | e.g. `/var/lib/barter-village/backups` | Local staging directory for snapshots. |
| `BACKUP_S3_ENDPOINT` | e.g. `https://s3.amazonaws.com` | S3-compatible endpoint. |
| `BACKUP_S3_REGION` | e.g. `auto` or `us-east-1` | S3 region. |
| `BACKUP_S3_BUCKET` | bucket name | Must exist. |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | IAM / S3 credentials | Write access to the bucket. |

## Database inspection

The SQLite database lives at `DATABASE_PATH` (`$dataDir/barter-village.sqlite`). Use
`sqlite3` directly or any SQLite tool.

```bash
# Open read-only
sqlite3 -readonly /var/lib/barter-village/barter-village.sqlite
```

### Useful queries

```sql
-- Current world tick and config
SELECT id, current_tick, season, weather, next_deadline FROM worlds;

-- Player roster
SELECT id, name, plot_id, energy, goodwill, badge, badge_name FROM players;

-- Player ready state for the current tick
SELECT p.id, p.name, r.tick, r.position
FROM player_ready r
JOIN players p ON p.id = r.player_id
WHERE r.tick = (SELECT current_tick FROM worlds LIMIT 1);

-- Queued orders
SELECT id, player_id, type, payload_json, energy_cost, queued_tick
FROM orders WHERE status = 'queued' ORDER BY queued_tick, position;

-- Open barter offers
SELECT id, poster_id, kind, gives_json, wants_json, expiry_tick
FROM posts WHERE status = 'open' ORDER BY created_tick;

-- Archived events (immutable, one per tick/sequence)
SELECT tick, sequence, type, payload_json FROM archived_events WHERE world_id = 'w1' ORDER BY tick, sequence;

-- Tick log headers
SELECT tick, header_json FROM tick_logs WHERE world_id = 'w1' ORDER BY tick;

-- Push subscriptions
SELECT player_id, endpoint FROM push_subscriptions;

-- Credentials (ciphertext only, never secrets)
SELECT id, player_id, kind, subject, public_key, created_at FROM credentials;
```

## Routine operations

| Task | Command / SQL |
|------|----------------|
| **View current tick** | `sqlite3 -readonly ... 'SELECT current_tick FROM worlds;'` |
| **List ready players** | see ready-state query above |
| **Requeue a stuck order** | Update `orders` status back to `queued` (only while tick is not resolving). |
| **Cancel an open offer** | `UPDATE posts SET status = 'cancelled' WHERE id = 'offer-xyz';` |
| **Force next tick (manual retry)** | `curl -X POST "https://api.example/world/w1/ticks/12/retry" -H "Authorization: Bearer <admin-token>"`  *(requires no resolving lease; see retry endpoint)* |
| **Worker CLI retry** | `sudo -u barter-village DATABASE_PATH=/var/lib/barter-village/barter-village.sqlite WORLD_ID=w1 /path/to/barter-village-worker retry-tick` |
| **Check worker logs** | `journalctl -u barter-village-worker -f` |
| **View push failures** | `journalctl -u barter-village-worker -g 'push failed'` |
| **Verify backup integrity** | Restore the latest `.enc` from S3, decrypt with `BACKUP_ENCRYPTION_PASSPHRASE`, open with `sqlite3 -readonly`, run the queries above. |

## Replay

```bash
# Latest replay JSON (includes header + all events)
curl "https://api.example/replay/latest" -H "x-world-id: w1" | jq .
```

## Failure modes

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| Tick stuck at `resolving` > 5 min | Resolution crashed, lease held | `DELETE FROM resolving_leases WHERE world_id='w1';` then retry |
| Replay 404 for latest tick | No tick has resolved yet | Wait for first resolution |
| WebAuthn registration fails | RP ID / origin mismatch | Ensure `rpID` = domain, `origin` = `https://domain` |
| Push notifications not received | VAPID keys wrong / subscription expired | Regenerate VAPID, clear `push_subscriptions` |
| Backup upload fails | S3 credentials / endpoint | Check `journalctl -u barter-village-backup` |

## Adding a new world

1. `sqlite3 ... 'INSERT INTO worlds (id, current_tick, season, weather, next_deadline) VALUES ("w2", 0, "spring", "sun", "2026-12-01T20:00:00Z");'`
2. Generate map regions as players claim plots (automatic on onboarding).

## No admin users

There is no `admin` role. All changes go through the configuration file,
environment file, or direct SQL. Any code change that adds an admin endpoint
must be rejected at review.