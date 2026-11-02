> Current connected-app architecture and run instructions: [CONNECTED_APPS.md](CONNECTED_APPS.md). The material below records the original single-app release.

# Architecture

## Runtime

Next.js App Router renders public pages and authenticated management screens. React client components implement cart state, native accessible product dialogs, Leaflet maps, calendar views and branding preview. Server Actions perform mutations; Route Handlers serve exports, QR images, health status and processed uploads.

Domain modules in `lib/` implement authentication, orders, operations, management, recovery and maintenance. They use Node 24's built-in `node:sqlite` driver with WAL, foreign keys and a five-second busy timeout. Orders and ledger effects use `BEGIN IMMEDIATE` transactions. The architecture targets a single server with durable local storage, not edge functions or horizontal replicas.

## Data isolation

Business membership is checked server-side for every management mutation and private export. Managers cannot edit branding or manage accounts; staff see operational screens and can update authorized orders and assigned tasks. Staff cannot view sales reports, export orders or edit business branding. Public pages select only public menu fields and public events. Database foreign keys and application checks enforce recipe/product/business consistency.

## Order lifecycle

Pending → Confirmed → Preparing → Ready → Collected. Cancellation is possible before collection. Order and payment state are separate. Preparation consumes reservations once, repeated state commands are harmless, and cancellation after preparation reclassifies the original stock deduction as waste. Item names, prices, customizations, category and pickup location are snapshots. Later product/recipe changes do not rewrite orders.

## Live data and offline use

Kitchen and tracking views poll every ten seconds when visible and online. No WebSocket infrastructure is needed. Public menu snapshots and public static assets are cached for read-only offline viewing. Private pages and mutation requests are not cached by the service worker. Cached menus state that availability/prices/locations can be stale. Offline checkout is disabled.

## Security and recovery

Passwords use salted scrypt. Opaque sessions and reset credentials are stored as hashes. Cookies are HttpOnly and SameSite=Lax, with Secure enabled in production. Next.js Server Actions provide origin checking; deployment proxies must preserve the correct host/origin. Login attempts and checkout submissions are throttled. Uploaded raster images are size-limited, decoded with pixel limits, re-encoded as WebP, and served from randomized filenames. No SVG uploads or executable uploads are accepted.

Recovery uses short-lived, single-use tokens and revokes existing sessions. The local mail outbox is outside the public directory. Replace file delivery with a configured provider before expecting automatic email. Logs should not include contacts, passwords or tracking credentials.

## Architecture change

PostgreSQL/Prisma was replaced with SQLite after the local database and network setup blocked development. The final application does not require PostgreSQL. `db/001_foundation.sql` is a superseded draft, not an active migration. npm installation was later repaired and the project has a lockfile. Production packaging uses Next standalone output and Node 24.
