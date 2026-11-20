# VPS Deployment Guide (M9.02)

## Prerequisites

- A dedicated VPS with a static public IPv4/IPv6 address
- A registered domain name with DNS control (A/AAAA records pointing to the VPS IP)
- NixOS installed on the VPS (or Nix installed with the `barter-village` flake)
- Port 443 (HTTPS) and 3000 (API) accessible from the internet

## Quick Start

### 1. Install Barter Village

```bash
# On the VPS, as root or with sudo:
nixos-rebuild switch --flake /path/to/bartervillage#barter-village

# Or build and run directly:
nix run github:bmordue/bartervillage#barter-village -- --help
```

### 2. Configure NixOS Module

Edit `/etc/nixos/configuration.nix` (or create a dedicated module file):

```nix
{
  services.barter-village = {
    enable = true;
    rpID = "bartervillage.example.com";      # Replace with your domain
    origin = "https://bartervillage.example.com:443";
    environmentFile = "/etc/barter-village.env"; # Secrets file (see below)
  };
}
```

### 3. Create Secrets File

Create `/etc/barter-village.env` with the following contents (never commit this file):

```bash
BARTER_CREDENTIAL_KEY=<openssl rand -base64 32 | tr '+/' '-_' | tr -d '='>
VAPID_PUBLIC_KEY=<from npx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<from npx web-push generate-vapid-keys>
VAPID_SUBJECT=mailto:admin@example.com
BACKUP_ENCRYPTION_PASSPHRASE=<high-entropy passphrase>
BACKUP_WORK_DIR=/var/lib/barter-village/backups
BACKUP_S3_ENDPOINT=https://s3.amazonaws.com
BACKUP_S3_REGION=us-east-1
BACKUP_S3_BUCKET=<bucket-name>
BACKUP_S3_ACCESS_KEY_ID=<access-key>
BACKUP_S3_SECRET_ACCESS_KEY=<secret-key>
```

Set restrictive permissions:

```bash
chmod 600 /etc/barter-village.env
chown root:root /etc/barter-village.env
```

### 4. Deploy with Caddy (HTTPS Reverse Proxy)

Copy the `Caddyfile` from the repository root, update the domain, and run:

```bash
# Install Caddy (or use NixOS caddy module)
nix-shell -p caddy --run "caddy validate --config Caddyfile"
nix-shell -p caddy --run "caddy run --config Caddyfile"

# For production, run Caddy as a systemd service with auto-restart
```

Or add Caddy as a NixOS module alongside the application:

```nix
services.caddy = {
  enable = true;
  email = "admin@example.com";
  configFile = "/path/to/Caddyfile";
};
```

### 5. Verify Deployment

```bash
# Check API health
curl https://bartervillage.example.com/health

# Verify WebAuthn endpoints are reachable
curl https://bartervillage.example.com/auth/passkey/register/begin

# Check service logs
journalctl -u barter-village-api -f
journalctl -u barter-village-worker -f
journalctl -u caddy -f
```

## DNS Configuration

Add the following DNS records in your registrar's control panel:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | YOUR_VPS_IP | 300 |
| AAAA | @ | YOUR_VPS_IPV6 | 300 |

Wait for DNS propagation (typically 5-10 minutes) before starting Caddy.

## Firewall Configuration

Ensure the following ports are open:

- **80/tcp**: HTTP (for Let's Encrypt ACME challenge)
- **443/tcp**: HTTPS (web traffic)
- **3000/tcp**: API (optional; only needed if not behind Caddy)
- **22/tcp**: SSH (for administration)

## TLS / HTTPS

Caddy automatically obtains and renews TLS certificates via Let's Encrypt. The
domain must be reachable from the public internet for certificate issuance.

If you prefer an alternative reverse proxy (nginx, Traefik), the API must still
listen on `127.0.0.1:3000` and be configured to accept requests via HTTPS proxy.

## Upgrades and Maintenance

```bash
# Pull latest code
git pull

# Rebuild and switch
sudo nixos-rebuild switch --flake .#barter-village

# Check services
systemctl status barter-village-api
systemctl status barter-village-worker
systemctl status barter-village-backup.timer

# View logs
journalctl -u barter-village-api -f
journalctl -u barter-village-worker -f
```

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|-----------|
| WebAuthn registration fails | RP ID / origin mismatch | Ensure `rpID` = domain, `origin` = `https://domain` |
| API unreachable | Service not running | `systemctl status barter-village-api` |
| TLS errors | DNS not propagated or Caddy misconfigured | Verify DNS records, run `caddy validate` |
| Database errors | Permission issues on data directory | `chown -R barter-village:barter-village /var/lib/barter-village` |