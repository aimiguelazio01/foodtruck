# Food Truck Live — project context

Last reviewed: 2026-11-05 (Europe/Lisbon).

This is the consolidated handoff for the project as found in the working tree. It covers the application, architecture changes, distribution work, Cloudflare pilot, installation portal, assets, verification records and remaining work. It is based on source files, package scripts, documentation and Git history. No application tests, builds, deployments or live service checks were run while creating this document. Recorded results below belong to their linked reports, not to a fresh certification of the current working tree.

## 1. Product and defaults

Food Truck Live is a food-truck ordering and operations system. Customers discover trucks, browse their menus, place collection orders and track preparation. Operators manage orders, menus, stock, events, employees, branding and a network of trucks.

- Interface: Portuguese (Portugal).
- Currency: EUR; monetary values use integer cents.
- Operational timezone: Europe/Lisbon; weekly scheduling accounts for daylight-saving changes.
- Inventory uses integer base units, such as grams, millilitres and portions.
- Demonstration businesses and their people, food and vehicle imagery are fictional.
- Collection payment is implemented. Demo payments are explicitly simulated.
- Real card processing and certified fiscal invoicing have not been delivered.

## 2. Architecture and evolution

### Original application: retained for reference

The root `app/`, `lib/`, `public/`, `tests/` and parts of `scripts/` contain the original Next.js application using Node 24's SQLite driver. It delivered persistent ordering and role-based management after early PostgreSQL/network setup problems. It used local storage, transactional stock handling, tracking cookies and polling.

This is historical architecture. Do not treat descriptions of SQLite as the active database for the connected applications. `db/001_foundation.sql` is an old draft rather than the current PostgreSQL migration entry point.

### Connected applications: current Node/PostgreSQL application

| Component | Location | Responsibility |
| --- | --- | --- |
| Customer site | `apps/customer/` | Catalogue, storefronts, cart, checkout, tracking, customer accounts, public locations, PWA |
| Management site | `apps/management/` | Kitchen/orders, products, inventory, events, people, network, settings and editors |
| API | `services/api/` | Fastify HTTP API, PostgreSQL persistence, authentication, domain operations, email, media and maintenance |
| Shared backend | `packages/backend/` | Cross-runtime contracts, database port, access checks and extracted business services |
| Installation portal | `apps/portal/` | Separate pilot UI for installation purchases, configuration and progress; admin area |
| Platform service | `desktop/launcher/platform/` | Go service and separate PostgreSQL schema for installation orchestration |

Pinned root dependencies include Next.js 16.4.3, React/React DOM 19.2.8 and TypeScript 5.9.3. Node 24 is the documented runtime. Other major dependencies include Leaflet, Sharp, QRCode, Fastify, pg, ExcelJS, Nodemailer and the AWS S3 SDK. Desktop/cloud tooling uses Go, Rust/Tauri 2, OpenNext, Wrangler and Miniflare/workerd.

The development supervisor starts the API, maintenance worker and customer/management sites. Default ports are customer 3000, management 3001 and internal API 4000. Local embedded PostgreSQL uses loopback port 5433. The separate pilot portal uses 4200 and its Go service 4100.

PostgreSQL changes support durable domain events and LISTEN/NOTIFY-driven SSE. Hosting adaptations also support polling; the UI reports the effective connection mode and refreshes on reconnection. Cloudflare D1 uses domain-event polling rather than PostgreSQL listeners.

### Shared PostgreSQL/D1 backend work

`packages/backend/db/port.ts` defines `all`, `first` and atomic `batch` operations. Shared SQL uses `?` placeholders; the PostgreSQL adapter translates them. Shared mutations reassert preconditions inside an atomic batch using write guards, conflict checks, audit records and domain events.

Extracted services currently cover inventory, products/catalogue, events, tasks and users/permissions. Shared access/capability helpers and scenario fixtures support both PostgreSQL and D1. This is an ongoing extraction; do not assume every API feature has been moved into the shared layer or that both deployments have complete feature parity.

## 3. Customer-facing work

- Multi-truck catalogue and independently branded truck storefronts with stable product ordering.
- Generated product photos, truck images, category filters, descriptions, allergens, ingredients, tags and availability.
- Product detail dialogs, extras, portion variants and required/optional modifier groups.
- Persistent cart, server-calculated pricing, expected-total checks and idempotent checkout.
- Published-event collection slots and capacity controls, customer contact details and collection location snapshots.
- Collection payment and restricted demonstration payment.
- Protected order tracking, status refresh, collection reference, date/time, location and item details.
- Customer registration, email verification, resend confirmation, login and password recovery.
- Guest-order association after login, idempotent ownership checks, account history and later tracking without the original guest cookie once associated.
- Current truck locations and upcoming published stops/events on the homepage; map/directions links.
- QR access, printable order summary, installable PWA metadata/icons and read-only offline public-menu fallback. Checkout is disabled offline.
- Branding updates propagate to both sites, document titles and PWA manifests.

## 4. Management and network work

### Orders and reporting

Order lifecycle: `pending -> confirmed -> preparing -> ready -> collected`, with cancellation allowed before collection. Payment state is separate: `unpaid`, `paid_collection` or `demo_paid`.

Orders snapshot product names, prices, options and collection details. Reservations are consumed once on preparation, released when appropriate, and prepared-order cancellation records waste. Versions and idempotency protect repeated/stale operations.

The order screen supports cards/list views, search, status filters, grouping by pickup day or event ID and saved view preferences. Kitchen controls and collection payment registration remain available in list mode.

Native Excel export includes Encomendas, Artigos and Histórico sheets, typed dates/numbers, line-subtotal formulas, filters and frozen panes. It exports all orders for the selected truck independently of screen filters, uses a repeatable-read snapshot on PostgreSQL, applies permissions and redacts restricted contacts. CSV reporting and network performance export are also present.

### Catalogue, inventory and customers

- Product/category editing, numeric display ordering, availability, full product details and raster-image uploads.
- Ingredient/supplier records, recipes, initial stock, replenishment, corrections, waste, reservations and movement history.
- Inventory search/filter/sort, low-stock alerts, conflict/version checks and guarded soft removal/restoration.
- Removal requires zero stock, no reservations and no live recipe/modifier/transfer dependencies. Used units cannot be changed freely.
- Customer aggregates, history, notes and anonymization.
- Filtered sales, product/location reporting, overview metrics and charts.

### Calendar, location and staff

- Day/week/month calendar, public/private events, weekly recurrence, event-specific menus and draft/publication state.
- Event truck selector, venue, address, Lisbon start/end, coordinates and Google Maps links.
- Leaflet/OpenStreetMap pin picking, dragging, keyboard placement, Photon address search/reverse geocoding and failure-safe manual entry.
- Authorized geocoding proxy, rate limits, bounded responses/cache and stale-response protection. Google Maps adapter is prepared but needs a real key for verification.
- Saved/manual locations and optional foreground GPS sharing; this requires an open page and permission.
- Users, role defaults and per-user/per-truck module grants. Administrators exclusively manage users/permissions; granting a manager all modules does not grant network administration.
- Tasks with descriptions, assignees, priority, deadline, status, search/filter, create/edit/delete and optimistic concurrency.
- Employee task visibility and assignment restrictions, personal availability and own schedule.

### Organization/network operations

Organizations link multiple trucks, with network-level membership, metrics, exports and audit history. Source includes truck creation/archive/restore, member assignment, staffing/availability/shifts and stock-transfer workflows. Truck creation/restoration enforces a 50-active-truck limit in the PostgreSQL network API.

Company data and application identity are stored per organization. Company legal/tax/headquarters fields are excluded from public branding. Application branding and truck branding are separate. `PUBLIC_ORGANIZATION_ID` selects public identity in multi-organization deployments.

### Appearance and touch interface

Application/truck identity editors provide logos, colors, social links, slugs, previews and configuration import/export. Later work adds independent catalogue background, truck-menu backgrounds, four fonts and three layouts. Customer-page links open the relevant public catalogue/storefront from management.

Management has a saved browser preference for Current/Touch layouts across orders, digital menu, customer-page editing and inventory. Touch mode enlarges controls to at least 52 px, increases spacing and adapts navigation for tablet widths. The preference key is `ft-management-layout-v1`.

## 5. Security, data and integrations

- Tenant/business scope and module permissions are checked server-side; archived trucks are excluded from public access.
- Sessions and recovery credentials are protected; staff/customer authentication remains separate.
- Legacy/Node security uses salted password hashing, hashed opaque session credentials and protected cookies. The Cloudflare implementation includes PBKDF2-SHA256 at 600,000 iterations with a compatible noble fallback for explicit WebCrypto iteration-limit rejection.
- Rate limits cover sensitive authentication, recovery, checkout and geocoding operations.
- Uploads validate raster formats/size, decode/re-encode and preserve transparency. Executable/SVG uploads are not part of the accepted product-image flow.
- Local uploads need durable storage; S3-compatible storage and Supabase media integration are included in API/deployment work. Cloudflare uses R2.
- Email supports Brevo HTTPS or SMTP with a configured sender. Production account/recovery operations report delivery configuration failures explicitly. Development can use a private local outbox.
- API migrations live in `services/api/migrations/`; D1 migrations and their manifest live in `deployment/cloudflare/migrations/`.
- PostgreSQL backup uses pg_dump, with matching media/object versions needed for recovery. Restore to a separate database and run invariant validation before cutover.
- Never import old SQLite data repeatedly as synchronization after new PostgreSQL writes.

## 6. Deployment and distribution delivered

### Web/self-hosting profiles

Docker, local/server Compose, Caddy HTTPS, Render, Vercel and Cloudflare profiles/scripts are present. Vercel work includes a Node HTTP API handler, serverless-safe database initialization, polling and request-driven maintenance. Supabase TLS/database/storage and Brevo setup are documented.

The early Cloudflare profile used two OpenNext frontends plus an external Node API. Later pilot work adds a native Worker API backed by D1/R2. These are different deployment generations.

### Marketplace source distribution

Version 1.0.1 source distribution uses a ZIP plus universal `INICIAR.mjs`, SHA-256 verification and automatic extraction. Code and persistent data are separated under `.foodtruck/releases` and `.foodtruck/data`. The launcher supports Windows x64, macOS Intel/Apple Silicon and Linux glibc x64/ARM64 with Node 24/npm installed. Packaging has an explicit file inventory and excludes operational data/secrets.

### Native local installers

`desktop/installer-config.json` identifies installer version 1.1.2 and five targets: Windows x64, macOS x64/ARM64, Linux x64/ARM64. Packages bundle Node.js, PostgreSQL and compiled application code; an icon launches the browser. Formats include Windows Setup, macOS PKG and Debian/Ubuntu DEB.

Windows install/start/restart/uninstall and preservation of user data were recorded as tested. macOS/Linux package contents and architectures were inspected, but native execution remains unverified. Packages are unsigned/not notarized.

Version 1.1.1 repaired demo product-image paths. Version 1.1.2 added an editable isolated demo, uploads/test orders, simulated email/payments, truck photography, catalogue/menu appearance and preserving migrations. Older source-launcher docs still describe a read-only demo; demo behavior must be interpreted per distribution/version.

Existing artifact locations include `release/installers/`, `release/marketplace/`, `output/pdf/` and `output/cloudflare/`. The latter contains preview.1 through preview.5 directories and a preview.5 ZIP/checksum. Their presence does not prove current-source equivalence or release approval.

## 7. Cloudflare installer and recovery engine

The Tauri 2 UI in `desktop/cloud-installer/` communicates with a Go sidecar using stdin/stdout. It selects authorized accounts, checks packages/licenses, collects business configuration and drives the Cloudflare engine. Tokens are not persisted by the UI.

The engine in `desktop/launcher/cloudflare/` provisions D1/R2, configures bootstrap, publishes API/customer/management Workers and verifies results. Signed package inventories, Ed25519 account-bound licenses, ownership tags and explicit cost approval protect publishing. The seller-only `license-tool` generates keys, issues licenses and signs packages. Signing a preview does not promote it to a commercial release.

Recovery journals record intentions, hashes and remote state before operations. Lost responses are reconciled rather than blindly creating/deleting resources. Temporary bootstrap/bridge Workers have repair/expiry/cleanup handling. `TESTAR-CLOUDFLARE.cmd` and the pilot PowerShell scripts support local pilot preparation/retry.

The preview.4 recovery report records PBKDF2 compatibility fixes and improved stage/error diagnostics, but still requires real confirmation of the earlier HTTP 503, login CPU/latency and complete publication. Local workerd tests do not establish Free-plan compatibility or real billing behavior.

The CI workflow prepares Windows NSIS, macOS universal DMG and Linux AppImage integration builds. Final native-window tests, other-platform workflow execution and commercial packaging are still pending according to the installer report.

## 8. Installation platform and portal pilot

This is newer work than the core local application and is not a completed commercial service.

Implemented in the Go platform service and portal:

- Administrative simulated purchases and one-time access codes stored by hash.
- Customer-isolated purchase queries, idempotent installation jobs, encrypted AES-GCM payloads, PostgreSQL execution exclusion, auditing and persisted progress stages.
- Managed-platform and customer-owned Cloudflare account modes.
- OAuth PKCE S256 with HttpOnly state cookie, ten-minute single-use state, server-encrypted tokens, account selection and immutable job/account association.
- Block/resume/cancel handling; active cloud operations finish before these actions take effect.
- Hosting preflight reads subscriptions plus D1/R2/Workers access. It recognizes WORKERS_PAID with Paid/Provisioned status; unknown contracts require review. No plan purchase is automatic.
- Managed simulated subscriptions, cancel-at-period-end and operator reactivation. Reactivation can grant a thirty-day test period; it does not charge a payment.
- Managed installations use a unique encrypted hosting credential and check central hosting status on each API request: expired returns 402; unavailable portal returns 503. No cache/grace period is implemented. Customer-owned mode is independent of this gate.

### Managed self-service hosting (direction chosen 2026-11-05)

Decision: Cloudflare only, with managed hosting on the operator's own account as the default; customers never create Cloudflare, Supabase or Brevo accounts. Free = trial (14 days by default), then a Stripe subscription. Customer sites live on `<slug>.<operator domain>`. All app email goes through one operator Brevo account. The desktop installer and customer-owned mode are advanced paths. Supabase, Vercel, Render and Docker self-hosting are legacy.

Built in phases 2-7, all tested only against mocks and local workerd/PostgreSQL, none against real Cloudflare, Stripe or Brevo:

- Worker API email and accounts: `deployment/cloudflare/mail.mjs`, `account-routes.mjs` (customer register/verify/resend/login/logout/me, staff and customer forgot/reset password).
- Custom addresses: `desktop/launcher/cloudflare/custom-domain.go`, slug reservation in `platform/`.
- Self-service signup, trial and Stripe: `platform/signup.go`, `billing.go`, `mail.go`.
- Lifecycle: `platform/lifecycle.go` (reminders, suspension, 30-day retention, final backup, queued teardown), `cloudflare/teardown.go`, hosting-gate persistence (`023_hosting_status`), `PLATFORM_MAX_INSTALLATIONS`.
- Portal wizard at `/`, old flow at `/avancado`.
- CI: `.github/workflows/platform.yml`.

Open before this can be sold: Phase 1 (first real managed install and the HTTP 503 / login CPU questions), the two from-memory Cloudflare endpoints, Stripe test-mode run, domain/DNS/Brevo setup, terms/privacy/VAT invoicing. Details and env vars: `deployment/platform/README.md`.

### Backup and isolated restore pilot

SQL export uses official D1 export, guarded ownership, serialized jobs, restricted presigned downloads, SHA-256 and encrypted central PostgreSQL storage. The pilot export limit is 32 MiB.

Optional SQL + images backs up R2 images to encrypted central storage with explicit destination confirmation. Limits are 1,000 images, 8 MiB per image and 32 MiB total image data. SQL/R2 are not captured in one atomic snapshot. Earlier paragraphs in the platform README describing SQL-only limitations are superseded by its later media sections.

Restore validation creates separate D1/R2 resources. It verifies checksums, imports SQL, checks integrity/foreign keys/bootstrap receipt and compares migration names/order/checksums against the signed package manifest. Media restoration uses a temporary secret-protected Worker, reads images back and checks hashes before Worker cleanup. Copies remain available and may incur cost.

Sessions, reset/verification tokens and temporary access counters are cleared only in the restored copy. A local isolated workerd test exercises login, permissions, catalogue/image reads, stock edits, idempotent checkout, cancellation and source isolation. Remote mocks and local tests do not prove a live customer's recovery works.

### Hosting preparation and remaining platform scope

Prepared pilot origin: `https://instalar.migfoodtruck.pt`, callback `/api/oauth/callback`. The 2026-11-04 report recorded NXDOMAIN and no domain purchase, DNS change or certificate issuance. This is historical evidence, not a current DNS check.

Docker/Caddy configurations keep the Go service and PostgreSQL private and expose the portal through HTTPS when configured. Domain/server control, secrets, signed packages, journal persistence, real OAuth and live acceptance are still prerequisites. The README's early pending list is partly superseded by later backup/preflight implementation; read the whole document and the validation report.

Still pending: automatic OAuth refresh/revocation, verification of billing/subscription lifecycle against real Stripe, real Cloudflare end-to-end tests, guided cleanup of copies, and production replacement with backup/confirmation/rollback. Existing installations are not automatically upgraded to the newer subscription/backup Worker bindings.

## 9. Assets, demo data and documentation

- PostgreSQL demo fixture: `deployment/demo/fixture.json`; documented as three businesses, 30 products, 72 orders, fictional contacts/staff, inventory, recipes, stock movements, events and tasks.
- Original demo conversion sources remain in `lib/demo*.mjs` and `scripts/export-demo-fixture.mjs`.
- `public/images/` and app-specific public folders contain product WebPs, food atlases, truck images, icons and branding graphics.
- `UPLOADS/` preserves original/generated images, prompts, logos, hot-dog demo catalogue/products and Bella Pizza sample material.
- `docs/screenshots/` records storefront, dashboard, network, product and mobile views.
- Portuguese usage/installation manuals are in `docs/manuals/`, with PDF copies there and in `output/pdf/`. Source images/attribution and PDF generation scripts are preserved.
- Distribution inventories, installation validation, release notes and platform-specific reports explain artifact scope and known limitations.

## 10. Commands and verification map

Use the actual current package scripts; several historical documents refer to removed script aliases. In particular, root `npm test` now runs the PostgreSQL distribution validator, not the original sixteen SQLite tests. The root `typecheck` script checks the API workspace only.

| Purpose | Command or location |
| --- | --- |
| Install dependencies | `npm ci --include=dev` |
| Fresh installation configuration | `npm run install:init`, edit private `.env.install`, then `npm run install:check` |
| Migrate / one-time setup link | `npm run db:migrate`, `npm run install:token` |
| Build configured installation | `npm run build:install` |
| Local PostgreSQL / development | `npm run db:local`, then configured `npm run dev` |
| Build / production supervisor | `npm run build`, `npm start` |
| API type checking | `npm run typecheck` |
| PostgreSQL distribution validation | `npm test` or `npm run test:distribution` |
| Cross-database shared-service scenarios | `npm run test:shared` |
| Cloudflare local/mocked suite | `npm run cloudflare:test` |
| Cloudflare builds / package | `npm run cloudflare:build`; `npm run cloudflare:package -- <version>` |
| Installer engine and UI tests | `npm run installer:test` |
| Platform integration with disposable PostgreSQL | `node scripts/with-test-postgres.mjs scripts/test-platform.mjs` |
| Native installer validation | `npm run test:desktop`, `npm run test:desktop:windows` |
| Release packaging / checks | `npm run package:release`, `npm run test:release` |
| Backups / manuals | `npm run backup`, `npm run manuals:build` |

Additional focused PostgreSQL scripts cover checkout, accounts, permissions, events/maps, inventory, tasks/shared services, tracking, streams, exports, installation and concurrency. Browser scripts under `e2e/` cover connected flows, offline behavior, events/maps, inventory, account association and Excel export. The portal is launched separately using `go -C desktop/launcher run ./cmd/platform` and `npm run dev --workspace=@foodtruck/portal`, with private environment configuration.

### Previously recorded results

- Original SQLite release: 16 domain/database tests, 14 Chromium/Firefox scenarios plus focused checks, accessibility/mobile checks, invariant validation and a separate-file backup restore.
- Connected PostgreSQL release: frontend/API builds, network/operations scenarios, account/checkout/recovery checks, a 500-order/50-truck burst and local 1,000-stream smoke check. Reported timings are local observations.
- Local installers 1.1.2: Windows runtime/setup/uninstall and browser personalization checks; other-platform package structure checks.
- Platform validation dated 2026-11-04: Go tests, 40 Cloudflare tests, shared inventory/catalogue/people scenarios on PostgreSQL, OpenNext builds, Wrangler dry-runs and preview.5 inventory/checksum verification.
- Restore additions: isolated local D1/R2 functional and session-reset tests; remote Cloudflare operations use mocks.

These results refer to the snapshots documented by their reports. The current dirty working tree was not retested for this context-file task. Docker execution, physical mobile testing, real OAuth/public portal acceptance, cloud billing/CPU behavior and live backup/restore remain separately unverified.

## 11. Git/worktree handoff

At review time HEAD was `7abd1f3` (shared DB port/services; inventory on PostgreSQL and D1), preceded by `0b71e7e` (Cloudflare hygiene/scripts/errors) and `af95512` (Cloudflare preview/cloud/local installer baseline).

There is substantial existing uncommitted work: shared catalogue/events/tasks/users/access services and scenarios; API integration changes; Cloudflare backup/restore/subscription/password/setup handling; Go platform service and commands; portal; Tauri UI/engine changes; pilot launchers, deployment docs and CI updates. These changes belong to the existing project work and must be preserved. This context document does not imply they have been committed or commercially released.

Version numbers describe different artifacts: root/source package 1.0.1, native installer 1.1.2 and Cloudflare 1.1.2-preview.5. Do not normalize them without checking each release mechanism.

## 12. Guidance for continuing work

1. Read `AGENTS.md` and any relevant nested instructions. Before writing Next.js code, read the installed guides in `node_modules/next/dist/docs/`; this repository explicitly warns that its framework version has breaking changes.
2. Work on `apps/customer`, `apps/management`, `services/api`, shared backend and deployment targets as appropriate. Root SQLite code is historical unless a task explicitly targets it.
3. Preserve existing uncommitted work, operational data, journals and resources. Keep credentials, private keys, tokens and private environment values out of source, logs, screenshots and handoff documents.
4. Preserve tenant scope, module grants, stock/reservation invariants, idempotency, version conflicts, price/order snapshots and Lisbon scheduling behavior.
5. For shared services, verify the same scenarios through PostgreSQL and D1 adapters. Build the relevant sites after UI changes; packaged previews are snapshots and must be regenerated deliberately.
6. Treat integration previews, mocked cloud tests and local workerd checks according to their stated limits. Follow the remaining acceptance work before calling the portal/cloud installer commercially ready.

## 13. Source index

- [Main README](README.md), [release notes](RELEASE_NOTES.md), [getting started](COMEÇAR_AQUI.md).
- [Connected apps and incremental features](docs/CONNECTED_APPS.md).
- [Historical architecture](docs/ARCHITECTURE.md), [original final report](docs/FINAL_REPORT.md), [historical testing](docs/TESTING.md), [database history](docs/DATABASE.md).
- [Demo data](docs/DEMO_DATA.md), [email](docs/EMAIL.md), [deployment](docs/DEPLOYMENT.md), [Vercel](docs/VERCEL.md), [Render](docs/RENDER.md), [free hosting](docs/FREE_HOSTING.md).
- [Installation validation](docs/INSTALLATION_VALIDATION.md), [usage manual](docs/manuals/UTILIZACAO_PT.md), [installation manual](docs/manuals/INSTALACAO_PT.md).
- [Installer validation](docs/distribution/VALIDACAO_INSTALADORES.md), [distribution inventory](docs/distribution/INVENTARIO.md).
- [Cloud installer](desktop/cloud-installer/README.md), [preview recovery](deployment/cloudflare/PILOT-RECOVERY.md).
- [Platform implementation and limitations](deployment/platform/README.md), [latest pilot validation](deployment/platform/VALIDATION.md), [pilot-domain preparation](deployment/platform/MIGFOODTRUCK.md).
