# Connected applications

The current architecture lives in `apps/customer`, `apps/management`, and `services/api`. The root `app` and `lib` directories retain the previous application for compatibility/reference; run its explicit `*:legacy` commands only when needed. Both new apps use the PostgreSQL API. The original SQLite file is preserved.

## Local development

1. `npm ci`
2. Run `npm run db:local` once to initialize PostgreSQL on loopback port 5433; it stores random credentials in ignored `data/network.env`. Keep this terminal running for the initial setup.
3. `node --env-file=data/network.env node_modules/tsx/dist/cli.mjs services/api/scripts/migrate.ts`
4. For an existing installation: `node --env-file=data/network.env node_modules/tsx/dist/cli.mjs services/api/scripts/import-sqlite.ts data/foodtruck.sqlite`
5. Grant network ownership explicitly: `node --env-file=data/network.env node_modules/tsx/dist/cli.mjs services/api/scripts/bootstrap-network.ts owner@urban-burger.demo`
6. `npm run dev`

Customer: http://localhost:3000. Management: http://localhost:3001. Internal API: http://127.0.0.1:4000. Once initialized, the supervisor can restart the local database if needed, applies migrations, and starts API, maintenance, and both frontends. An external PostgreSQL DATABASE_URL can be used instead. Production: `npm run build`, then `npm start`.

Imported demo login: owner@urban-burger.demo / DemoFoodTruck2026!. Only the explicitly bootstrapped user has network authority; existing truck roles retain their scope.

## Data and verification

`node --env-file=data/network.env node_modules/tsx/dist/cli.mjs services/api/scripts/validate.ts` checks order totals, stock movements, reservations, and recipe isolation. New live PostgreSQL integration tests use isolated schemas and clean up afterward; scripts are under `services/api/scripts/test-*`. Original domain tests remain available with `npm test`.

Do not rerun import into a live modified installation as a synchronization mechanism. Back up SQLite/media before the cutover; pause writes during final conversion. Keep both apps on the same API version. After PostgreSQL accepts new writes, rollback needs reconciliation.

## Hosting

`compose.network.yaml`, `Dockerfile.network`, and `Caddyfile.network` provide a separate customer origin, management origin, internal API, and persistent PostgreSQL. Copy `.env.network.example` to `.env.network` and configure real origins and secrets. Docker Compose interpolation also needs POSTGRES_PASSWORD, CUSTOMER_DOMAIN, and MANAGEMENT_DOMAIN in its environment or via `--env-file .env.network`.

Build on a separate release checkout. Apply versioned migrations before starting the API using its migrate command. Run the worker alongside the API. Keep PostgreSQL inaccessible from the public network. Caddy routes streaming API requests directly and flushes SSE updates immediately.

Set SMTP_URL and MAIL_FROM for external verification/recovery delivery; local development writes a private JSONL outbox under data. Set S3_BUCKET, AWS_REGION, and standard AWS credentials for object storage, optionally S3_ENDPOINT for compatible services. Without S3, uploads use DATA_DIRECTORY/uploads and require a persistent volume. Images are validated and re-encoded with alpha preserved.

Public hosting requires a configured host and DNS; this repository does not provision accounts or domains. Back up PostgreSQL with pg_dump nightly, retain backups off-host, version media, and rehearse restoration before release. Keep DEMO_MODE=0 in production. Payment on collection is supported; simulated payments are restricted to demo mode.

## Verification recorded during this implementation

Both Next.js applications and the TypeScript API build successfully. The original 16 domain tests pass. Five new network/operations tests pass against PostgreSQL, plus isolated checkout, customer identity/recovery, staff recovery, legacy tracking, DST recurrence, and burst scenarios. The burst fixture processed 500 concurrent orders across 50 synthetic trucks with correct stock and durable events. A separate local smoke check maintained 1,000 event streams and 100 concurrent menu reads; observed event p95 was 263 ms. These are local capacity checks, not a production service guarantee.

Browser checks cover customer ordering, corresponding kitchen updates, cancellation/reservation release, mobile overflow, verified account access, legacy tracking cookies, and account order access from a separate browser. Generated OpenAPI is available at `/api/v1/openapi.json`. Screenshots are under `docs/screenshots/`.

Production hosting/DNS, external SMTP and S3 require configuration. Docker is supplied but could not be executed on this Windows host because Docker is unavailable. Physical iPhone/Android testing remains a deployment acceptance step. `npm run backup` uses PostgreSQL `pg_dump`; install matching client utilities or set PG_DUMP_BIN. Restore into a separate database with `pg_restore --no-owner --dbname=... database.dump`, restore the matching upload directory or object versions, and run the invariant validator before cutover. Do not restore over a running writable installation.

## Fresh production network

For a new empty installation, run migrations, then set FOODTRUCK_ADMIN_PASSWORD temporarily and execute `npm exec --workspace=@foodtruck/api -- tsx scripts/create-network-admin.ts owner@example.com "Company name"` with DATABASE_URL configured. Clear the password environment variable afterward. This creates one organization and its first owner without demo data; sign into management to create trucks and assign staff. For the supplied existing demonstration, use the documented import/bootstrap sequence instead.

The final production proxy check received immediate SSE chunks without gzip buffering. Focused browser order confirmation/cancellation propagated in 149/169 ms. Customer mobile accessibility passed Chromium and Firefox; Chromium offline viewing showed the saved menu with ordering unavailable. Reconnection now refetches current data and displays the connection state.

## Per-user permissions and complete product editor

Migration 011 adds per-user, per-truck module grants. Administrators (network owner/admin or truck owner/admin) retain full control and exclusively manage users and permissions. In management, select a truck and open **Utilizadores e permissões**. Create an employee or manager, tick allowed modules, or use **Apenas menus e inventário**. Existing accounts keep their role defaults until an administrator saves custom grants. A manager granted all modules cannot administer users or the network. Revocation is checked server-side on every operation; the dashboard refreshes its grants on reconnect and its 15-second refresh. Menus, inventory, orders, calendar/location, branding, customers, reports, tasks, and own schedule are independent modules.

**Menu digital → Criar ou editar produto** now saves description, category, allergens, ingredients, tags and optional image alongside name, price and availability. Images accept PNG/JPEG/WebP up to 3 MB. Product and detail records commit together.

Isolated verification: `node --env-file=data/network.env node_modules/tsx/dist/cli.mjs services/api/scripts/test-permissions.ts`.

## Task management

Migration 012 extends existing tasks with description, priority, deadline, status, creation time and version. **Tarefas** now includes creation/editing, assignee selection, search, filters, counters, start/complete/reopen and confirmed deletion. Administrators/managers with task access can manage all tasks in the selected truck. Employees with task access can create personal tasks and work on assigned/unassigned tasks; they cannot assign work to other users or access tasks assigned to others. Updates use optimistic versions; conflicts require refreshing/reopening the editor. All mutations are audited and emit real-time invalidations.

## Customer page access from management

**Página de encomendas** opens the customer catalogue or the selected truck menu in a separate tab, and links to the identity editor and product editor according to the user's module grants. The management header and network truck rows also link to the public menu. Redirects use runtime CUSTOMER_APP_URL (localhost:3000 by default). Archived trucks remain editable but do not expose a public-menu link until reactivated.

## Company data and application identity

Migration 013 stores company data and application branding per organization. Network administrators see **Dados da empresa** and **Personalização**. The first contains trading/legal name, tax number, headquarters address, public email/phone and website. The second controls application name, logo, primary/navigation/accent colors and a live preview. Fiscal data and headquarters address are excluded from the public branding response. Truck branding remains independent.

Both apps use the published name/logo/colors; page titles and PWA manifests use the same identity. Branding refreshes on window focus, every 30 seconds, and immediately in management after saving. Existing installed PWAs may require reopening or browser-managed update to refresh their icon/name. Set PUBLIC_ORGANIZATION_ID when the database contains more than one organization; otherwise a single organization is selected automatically. With multiple organizations and no selection, neutral default branding is used. Local SMTP sender names and domains remain deployment configuration.

## Ingredient inventory management

The inventory screen now supports search by name/supplier, available-stock filters, name/availability sorting, ingredient editing, initial stock, stock movements, and per-ingredient movement history. Available stock is total minus reserved stock; an alert appears at or below the configured minimum.

Use **Registar movimento** for replenishment, waste, or a stock correction. Quantities are whole numbers in the ingredient's configured unit; use grams or millilitres for fractional kilograms/litres. Initial stock creates a ledger entry. Existing quantities cannot be changed through metadata editing.

**Remover** requires confirmation, zero stock, no reservations, no recipe/extra/modifier associations, and no draft/dispatched transfers. Removal hides the ingredient while retaining its history. Select **Mostrar → Removidos** to restore it. Removed ingredients cannot receive movements, recipe associations, or new transfer mappings. Unit changes are blocked after use.

Migration `014_inventory_management.sql` adds removal timestamps and inventory versions. A database trigger advances the version on all stock/reservation/metadata changes; stale edits and movements return a conflict. Inventory routes enforce the inventory permission and business scope.

Focused checks:
- `node --env-file=data/network.env node_modules/tsx/dist/cli.mjs services/api/scripts/test-inventory.ts` — uses an isolated PostgreSQL schema and cleans it up.
- `node --env-file=data/network.env e2e/inventory-browser.cjs` — checks the local UI with a temporary ingredient and cleans it up.

## Event editor and Google Maps coordinates

The Calendar editor provides a truck selector, event title, optional venue name, address, start/end in Europe/Lisbon time, publication status and event type. Events can be saved as drafts or published; only published events appear publicly and provide collection slots.

The optional Google Maps section accepts a latitude/longitude pair, direct numeric entry, or a full Maps URL containing coordinates. It fills the coordinate fields and provides a link to check the location. Short links without embedded coordinates are not resolved; copy the coordinates from Maps instead. Published events show the venue and a Maps link on the customer menu.

Migration `015_event_locations.sql` adds venue name, paired coordinates and event versions. Edits enforce calendar access for the source and destination trucks, reject overlapping time ranges, preserve existing recurring-event creation, and protect events with orders/menu associations from reassignment. Location/time/publication changes are blocked while relevant orders are active. Existing historical collection addresses remain intact.

Checks: `node --env-file=data/network.env node_modules/tsx/dist/cli.mjs services/api/scripts/test-events.ts` uses an isolated schema; `node --env-file=data/network.env e2e/event-editor.cjs` checks draft/publication and customer visibility using a temporary event that is cleaned up.

## Event address and pin picker

In Calendar, an event can be saved with a manually entered address, a coordinate pair, or both. At least one valid location representation is required. For coordinate-only events, the customer page shows the map link and order snapshots use the coordinates rather than an unrelated truck address.

The default demo picker uses Leaflet/OpenStreetMap with Photon geocoding. Click the map, drag the pin, or pan using the keyboard and press **Colocar pin no centro do mapa**. Selecting a point immediately fills coordinates and attempts reverse geocoding. Users can edit the suggested address; delayed responses do not replace text entered after a lookup starts. Lookup failures retain the selected coordinates. **Localizar morada no mapa** searches the typed address and lets the user select a result. There is also a link to open the selected point in Google Maps.

The API proxies explicit geocoding actions through calendar-authorized business routes, serializes provider requests, caches results for five minutes, deduplicates pending identical lookups, limits per-user lookups and bounds response/cache sizes. No background polling or search-as-you-type requests are sent. `GEOCODING_BASE_URL` selects a Photon-compatible service. The public Photon demo is for moderate demo use and has no availability guarantee; use a private/licensed service for production volume. See [Photon documentation](https://github.com/komoot/photon) and [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

Optional Google integration is prepared: configure a browser-restricted `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` with Maps JavaScript and geocoding enabled, then restart. The adapter uses Google maps, an advanced draggable marker and Google's browser geocoder. Only the free provider path was verified against real services in this session; a real Google key is required to verify that path. Setup reference: [Google Maps JavaScript API](https://developers.google.com/maps/documentation/javascript/get-api-key). Leave the key empty to use the working free demo map.

Checks: `test-events.ts` covers optional address, geocoding validation, permissions, cached requests and provider failure; `node e2e/event-map.cjs` checks real pin clicks/drags, address search, delayed-result protection, outages and mobile layout without saving events. The existing event-editor browser check still passes and cleans up its temporary event.

## Customer order association and collection details

On the tracking page, **Associar à minha conta** now gives visible progress and redirects guests to the customer login with only the order ID in the URL. After customer login, the pending association resumes automatically using the original tracking cookie or existing session proof. Staff sessions remain separate from customer accounts. Existing associations are idempotent for the owner and cannot be transferred to another customer.

**A minha conta** now shows the collection number used by management (the same six-character reference), Portuguese status, truck name, pickup date/time in Europe/Lisbon, pickup location, items, total and a tracking link. History refreshes every 15 seconds and on window focus. The tracking page displays the same collection details and links directly to the account when already associated. An associated customer can track the order later without its original guest tracking cookie.

Checks: `node --env-file=data/network.env node_modules/tsx/dist/cli.mjs services/api/scripts/test-customer-claims.ts` uses an isolated schema. `node --env-file=data/network.env e2e/customer-claim-order.cjs` tests guest -> customer login -> automatic association -> history -> automatic ready-status refresh -> tracking without guest proof; it cleans up its temporary customer/order.

## Orders list, grouping and Excel export

The Orders screen supports **Cartões** and **Lista**, with saved view/grouping preferences. Group by pickup day (using creation day when pickup is missing), by event ID, or show all records together. Same-name events remain separate. Order rows retain status transitions and collection payment registration, and show pickup time, location, items, choices, payment and total. Search/status filters affect the screen.

**Exportar Excel** downloads a native .xlsx for every order of the selected truck, independently of screen filters. The workbook has Encomendas (one row per order), Artigos (one row per order line, with quantity, snapshot unit price, choices and subtotal formula), and Histórico (order/payment audit entries). It includes full order/event IDs, event venue/address/coordinates, publication, pickup location, timestamps, account-association flag and order version. Dates are typed Excel dates displayed in Europe/Lisbon wall time; money and quantities remain numeric. Header filters and frozen panes are included.

Exports use a repeatable-read snapshot and enforce the same order capability and truck scope as the screen. Staff contacts remain redacted. Tracking proof hashes, payload hashes and session credentials are never exported. The API uses ExcelJS as a runtime dependency, so downloading does not depend on a Codex runtime.

Checks: `node --env-file=data/network.env node_modules/tsx/dist/cli.mjs services/api/scripts/test-order-export.ts` validates an isolated export including tenant boundaries, contact redaction, typed dates/numbers, literal formula-like customer names, empty exports and subtotal reconciliation. `node --env-file=data/network.env e2e/orders-list-export.cjs` checks grouping, list actions, preferences, mobile layout and the downloaded workbook, then cleans up temporary orders/events. The generated test workbook was also imported, inspected and visually rendered with Artifact Tool.
