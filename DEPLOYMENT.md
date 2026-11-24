# Deployment runbook (M9.02; spec §12)

This runbook documents how to deploy Barter Village to a cheap VPS with HTTPS and a
stable WebAuthn relying-party ID. It is a manual procedure — there is no in-game
admin UI.

## Try it locally (no VPS)

You can run the whole stack on your machine without a domain, HTTPS, nginx or
systemd. Only Node 22+ (or `nix develop`) is required.

1. Install dependencies and create a local environment file:

   ```sh
   npm install
   cp .env.example .env
   ```

   Edit `.env` for local play:

   ```
   DATABASE_PATH=./barter-village.sqlite
   WORLD_ID=w1
   NODE_ENV=development
   BARTER_RP_ID=localhost
   BARTER_ORIGIN=http://localhost:5173
   ```

   `WORLD_ID` must be `w1` because the client requests that world, and
   `BARTER_ORIGIN` must be the browser's origin (`5173`) for passkeys.

2. Generate the optional VAPID keys (the tick worker needs them to deliver push
   notifications; without them a resolved tick logs a push error):

   ```sh
   npx web-push generate-vapid-keys
   ```

   Put the output in `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.

3. Seed a playable world. This creates `./barter-village.sqlite` with world `w1`,
   a generated region, and player `p1` with a plot and starter buildings. It is
   safe to run more than once:

   ```sh
   set -a; source .env; set +a
   npx tsx scripts/seed-local.ts
   ```

4. Start the API in one terminal:

   ```sh
   set -a; source .env; set +a
   npm start --workspace @bartervillage/server
   ```

5. Start the tick worker in a second terminal (optional, but needed to resolve
   ticks when you mark yourself ready):

   ```sh
   set -a; source .env; set +a
   npm start --workspace @bartervillage/worker
   ```

6. Start the client in a third terminal:

   ```sh
   npm run dev --workspace @bartervillage/client
   ```

   Open <http://localhost:5173/?player=p1>. The Vite dev server proxies the API
   routes to `http://127.0.0.1:3000`, so no reverse proxy is needed.

To start over, stop the processes, delete `barter-village.sqlite` (plus the
`-shm`/`-wal` files) and rerun the seed script. Discord and GitHub login are
disabled while their client IDs are unset; local passkey login needs
`BARTER_ORIGIN=http://localhost:5173` to match the page origin.

## Prerequisites

- A VPS running NixOS (or any Linux distro with `nix` installed) with at least 2 GB
  RAM and 20 GB free disk.
- A domain name with a stable A/AAAA record pointing at the VPS (e.g.
  `barter-village.example.com`).
- An NixOS configuration that enables the `barter-village` NixOS module from
  `flake.nix` and sets `services.barter-village.enable = true`.

## Configure the NixOS module

```nix
{
  config,
  lib,
  pkgs,
  ...
}

let
  flake = builtins.getFlake "github:bmordue/barter-village";
in
{
  imports = [ flake.nixosModules.default ];

  services.barter-village = {
    enable = true;
    # Public domain name; serves HTTPS and is the WebAuthn RP ID.
    domain = "barter-village.example.com";
    # API listens on localhost:3000; nginx proxies to it on 443.
    host = "127.0.0.1";
    port = 3000;
    rpID = "$domain"; # must equal `domain`
    origin = "https://$domain"; # HTTPS required in production
    # Secrets live in a systemd environment file, never in the Nix store.
    environmentFile = "/etc/barter-village/secrets.env";
    backup.enable = true;
  };

  # nginx + Let's Encrypt are enabled by `nginx.enable` (default false).
  # Set to true to serve HTTPS via nginx and obtain certificates with ACME.
  services.barter-village.nginx.enable = true;

  # Optional: enable the ACME service for the domain.
  security.acme = {
    enable = true;
    acceptTerms = true;
    email = "admin@barter-village.example.com";
  };
}
```

## Secrets file

Create `/etc/barter-village/secrets.env` (mode 0600, owned by root) with every
secret the services read. See `.env.example` for the full list:

```
BARTER_CREDENTIAL_KEY=<32-byte base64url key>
BARTER_DISCORD_CLIENT_ID=
BARTER_DISCORD_CLIENT_SECRET=
BARTER_DISCORD_REDIRECT_URI=https://barter-village.example.com/auth/discord/callback
BARTER_GITHUB_CLIENT_ID=
BARTER_GITHUB_CLIENT_SECRET=
BARTER_GITHUB_REDIRECT_URI=https://barter-village.example.com/auth/github/callback
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@barter-village.example.com
BACKUP_WORK_DIR=/var/lib/barter-village/backups
BACKUP_ENCRYPTION_PASSPHRASE=<strong passphrase>
BACKUP_S3_ENDPOINT=
BACKUP_S3_REGION=auto
BACKUP_S3_BUCKET=
BACKUP_S3_ACCESS_KEY_ID=
BACKUP_S3_SECRET_ACCESS_KEY=
```

Generate missing values:

- `BARTER_CREDENTIAL_KEY`: `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`
- `VAPID_*`: `npx web-push generate-vapid-keys`
- `BACKUP_ENCRYPTION_PASSPHRASE`: `openssl rand -base64 32`

## Deploy

```sh
# On the VPS
sudo nixos-rebuild switch --flake github:your-username/barter-village#nixos
```

This starts the API, tick worker, nightly backup service, and (if enabled) the
nginx reverse proxy with Let's Encrypt certificates.

## Verify

```sh
# HTTPS is reachable and serves the API
curl -sS -o /dev/null -w "%{http_code}\n" https://barter-village.example.com/health

# WebAuthn RP ID is stable and matches the domain
curl -sS https://barter-village.example.com/auth/passkey/options \
  -H "x-world-id: village" | jq '.rpId'

# Tick worker is running
systemctl status barter-village-worker
```

## Troubleshooting

- **`WebAuthn requires HTTPS origins in production`**: `BARTER_ORIGIN` must start
  with `https://`. Set it to `https://<domain>`.
- **`Content version mismatch`**: the API reads the pinned content version from
  the database. After a content update, run a migration before restarting.
- **Stalled ticks**: see `M9.11` alerting and retry runbook. Manual retry:
  `POST /world/:worldId/ticks/:tick/retry` (requires no resolving lease).

## Notes

- The API binds to `127.0.0.1:3000` by default. nginx proxies to it on port 443
  with `forceSSL` and ACME certificates.
- The WebAuthn RP ID must remain stable across deployments. Changing it invalidates
  existing passkeys.
- This runbook is for manual admin operations only. There is no in-game admin UI.