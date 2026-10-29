# Deployment

## Supported target

One Node.js 24 server with a persistent local filesystem. SQLite WAL and uploaded files must stay on durable local storage shared by the app and its maintenance worker. Multiple horizontally scaled replicas, edge runtimes and ephemeral serverless filesystems are not supported by this SQLite architecture.

## Local production build

1. Run `npm ci`, `npm run setup`, and optionally `npm run seed` for a fictional demo.
2. Set APP_URL to the actual public HTTPS origin before generating QR codes or reset links. Set DEMO_MODE=0 outside an isolated demo.
3. Run `npm run build`, then `npm start`. The start script copies public/static assets into Next standalone output and resolves the data directory before the server changes its working directory.
4. Run `npm run worker` under the same service supervisor. It runs expiry, retention and credential cleanup every minute.
5. Poll `/api/health` for database connectivity. Protect private data and outbox directories using filesystem permissions.

Stop the app before rebuilding the same checkout, especially on Windows, where loaded native libraries lock files. Prefer building a separate release directory and switching the service after checks pass.

## Container configuration

Docker is optional and was not installed in the development environment, so container execution is **not verified**. `Dockerfile` builds Next standalone output, includes native sharp libraries, runs as a non-root user and exposes a health check. `compose.yaml` provides an app, a maintenance worker and a shared data volume.

Run `docker compose up --build -d` on a Docker-capable host. Create a non-demo business using `docker compose exec app node scripts/create-business.mjs slug "Business name"`, then create its owner using scripts/create-user.mjs with a temporary FOODTRUCK_ADMIN_PASSWORD environment variable. Never bake this password into an image or commit it.

The Compose port binds only to 127.0.0.1. Configure an HTTPS reverse proxy such as Caddy using `Caddyfile.example`, point the domain to the host, and set APP_URL accordingly. A managed VM/container host with persistent disk is suitable. Localhost is not public hosting, and this project has not provisioned a domain or activated a hosted service.

## Required configuration

- DATABASE_PATH: SQLite file path; use an absolute path in hosted processes.
- DATA_DIRECTORY: private parent directory for uploads and reset outbox, default `data`.
- APP_URL: public origin used for QR/reset links.
- DEMO_MODE: `1` to show fictional demo access, otherwise `0`.
- NEXT_PUBLIC_TILE_URL: tile URL compiled into the client. Use a provider and attribution appropriate to production traffic. Default OSM tiles are for light local/demo use; comply with the provider policy.

The reverse proxy must overwrite untrusted forwarded client-IP headers used for checkout rate limiting. Serve HTTPS so secure session/tracking cookies work. Keep Node and dependencies patched; run `npm audit --omit=dev` before release. Do not expose the development server publicly.

## Backups and upgrades

`npm run backup` uses VACUUM INTO to create a consistent file in `data/backups/`. Copy backups and `data/uploads` to protected off-host storage on a schedule. Test restoration to a separate database, run PRAGMA integrity_check and scripts/validate.mjs, then start against that restored copy. Stop app/worker before replacing a live database; preserve the previous complete data directory, including WAL/SHM files, for rollback. Additive schema initialization runs on startup. Keep the previous application release and matching database backup before upgrades.

## External integrations

Payment-on-collection and a labeled simulated payment path work without processor credentials. Stripe/PayPal charges and refunds are not connected. Password recovery creates a private local outbox file; configure an actual email-delivery adapter and provider for automatic mail. GPS needs browser permission and a secure context. Geocoding is unconfigured, while manual addresses and coordinates work. Fiscal invoicing, tax certification and legal/GDPR certification are not claimed.
