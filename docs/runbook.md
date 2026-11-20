# Host alert and stalled-tick retry runbook (M9.11)

## Alerts

The tick worker emits structured alerts when the same tick fails three consecutive
times (see `packages/worker/src/tickWorker.ts` and decision `D.09`):

```text
worker: ALERT [D.09] tick <worldId> tick <tick> reached <count> consecutive failures
```

Watch them with:

```bash
journalctl -u barter-village-worker -f | grep 'worker: ALERT'
```

The API/worker pair is run under systemd with:

```bash
systemctl status barter-village-api
systemctl status barter-village-worker
journalctl -u barter-village-worker -u barter-village-api -f
```

## Retry procedure

1. Confirm the worker is not holding a resolving lease:
   `sqlite3 -readonly /var/lib/barter-village/barter-village.sqlite "SELECT * FROM resolving_leases;"`
2. Call the safe manual retry endpoint for the stuck tick:
   ```bash
   curl -X POST "https://api.example/world/w1/ticks/12/retry" \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"worldId":"w1"}'
   ```
   Or use the worker CLI:

   ```bash
   DATABASE_PATH=/var/lib/barter-village/barter-village.sqlite \
   WORLD_ID=w1 \
   /path/to/barter-village-worker retry-tick
   ```

3. Verify the outcome in the logs:
   ```bash
   journalctl -u barter-village-worker -f | grep '^retry:'
   ```

4. Confirm the tick log was written:
   ```bash
   sqlite3 -readonly /var/lib/barter-village/barter-village.sqlite \
     "SELECT tick, header_json FROM tick_logs WHERE world_id='w1' ORDER BY tick DESC LIMIT 1;"
   ```

## Escalation

- If retries keep failing after three attempts, treat the failure as operational: page
  the on-call engineer and inspect data/content integrity before touching the tick.
- If the worker process itself exits, systemd restarts it (default policy: `Restart=on-failure`).
- If the API is unreachable, restart it:
  ```bash
  systemctl restart barter-village-api
  ```
- If the API process fails repeatedly, inspect logs and the SQLite database.

## Push failure handling

Push deliveries that fail are logged and never affect resolution:

```bash
journalctl -u barter-village-worker -g 'push failed'
```

Clear or refresh push subscriptions as needed; notifications are best effort (iOS
requires an installed web app).
