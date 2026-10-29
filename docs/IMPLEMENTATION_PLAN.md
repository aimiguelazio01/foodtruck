# Implementation plan and completion gates

## Delivery target

Food Truck Live is a Portuguese (Portugal), EUR, Europe/Lisbon browser application with owner/manager/staff management and public guest ordering. The implemented architecture uses Next.js 16.4.3, React, TypeScript and Node 24 built-in SQLite. The original PostgreSQL/Prisma plan was replaced after environment inspection; a single server with persistent local storage is the supported deployment target.

## Execution phases

1. **Architecture/environment:** inspect the empty workspace, establish repository conventions, document stack decisions and restore npm access. Acceptance: lockfile, supported versions and repeatable setup commands.
2. **Foundation:** application routing, styling, SQLite schema initialization, foreign keys, WAL, health endpoint and transaction helpers. Acceptance: restart persistence, successful production build and integrity validation.
3. **Identity/businesses:** salted password hashes, sessions/revocation, login/logout, recovery, business memberships and role checks. Acceptance: unauthorized roles and cross-business accesses fail on the server.
4. **Menu:** product/category editing, availability, descriptions/allergens/ingredients, photos, promotions, sizes, extras and modifier groups. Acceptance: public browsing uses persistent records; invalid/required choices are rejected server-side.
5. **Guest ordering:** cart, authoritative price quote, pickup slots, capacity, idempotency, confirmation and authorized tracking. Acceptance: customer-to-kitchen-to-collection browser workflow and duplicate-request protection.
6. **Kitchen/owner operations:** overview, active queue, status controls, collection payment recording, automatic refresh and staff tasks. Acceptance: valid transitions, payment gate and staff access restrictions.
7. **Locations/events:** draggable map, manual coordinates, directions, saved locations, opt-in foreground GPS, public/private events, day/week/month calendar, weekly recurrence and event menus. Acceptance: public/private boundaries, overlap checks, pickup availability and Lisbon DST tests.
8. **Inventory/customers/reports:** ingredients, suppliers, recipes, reservations, stock movement history, cancellation waste, customer notes/history/anonymization, filtered reports and CSV. Acceptance: concurrent final-unit contention, no negative stock, reconciled ledgers and matching totals.
9. **Demo/assets:** three fictional businesses, thirty menu products/images, staff, customers, historical/active/cancelled orders, upcoming events and low-stock cases. Acceptance: repeatable seeds, image delivery and database validation.
10. **UX/resilience:** mobile/desktop layouts, accessible controls and native dialogs, keyboard alternatives, reduced-motion CSS, manifest/icons, read-only offline menus and disabled disconnected checkout/staff writes. Acceptance: mobile overflow and axe checks, offline browser workflow.
11. **Regression/security:** unit/database/concurrency tests; Chromium/Firefox browser scenarios; dependency audit and native-runtime packaging checks. Acceptance: final test suite passes and no high/critical production dependency advisory remains.
12. **Packaging:** setup/seed/build/start/worker/backup commands, standalone output, Docker configuration, persistent volume and HTTPS guidance. Acceptance: packaged Windows runtime works and a backup restores with integrity checks. Docker execution remains unverified where Docker is unavailable.
13. **Handoff:** reconcile functionality and limitations, update documents and progress, preserve a repository checkpoint and open a local preview. Acceptance: final report states actual tests and external integration limits.

## Invariants

All private operations resolve business membership server-side. Money is integer cents; inventory is integer base units. Checkout and stock reservation are atomic. Preparation consumes stock once; pre-preparation cancellation releases it, later cancellation records waste. Payment and order state remain separate. Private tracking requires a hashed secret and an HttpOnly browser cookie. Public references never authorize private customer details. Offline views never claim live availability or queue unverified writes.

## External configuration and retained limits

Real payment processing, automated external email, geocoding, domain/HTTPS provisioning and a production map provider require external setup. Local substitutes are clearly labeled. Marketplace generation and certified invoicing are outside this repository. Read FEATURES.md and FINAL_REPORT.md for the exact implemented capability set and any broader original-brief items not delivered.
