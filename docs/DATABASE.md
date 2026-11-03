> Instalação atual PostgreSQL: consulte [o manual de instalação](manuals/INSTALACAO_PT.md). A secção abaixo é histórica, da versão SQLite, e não descreve a base ativa.

> Current connected-app architecture and run instructions: [CONNECTED_APPS.md](CONNECTED_APPS.md). The material below records the original single-app release.

# Database

The active database is SQLite at `DATABASE_PATH` (default `data/foodtruck.sqlite`). Setup is idempotent. The base schema is initialized by `openDatabase`; authentication and operational additions are applied by `authSchema` and `orderSchema`/`operationsSchema`. Additive columns are checked before applying updates. Back up before upgrading. There is no dependency on the old PostgreSQL draft.

Tables cover businesses, users, memberships, hashed sessions, login attempts, products/details, categories, orders and item snapshots, settings, inventory, recipes, reservations, stock movements, events, event-specific menus, saved locations, tasks, customer notes, audit events, password resets, request limits and demo markers.

Stock quantities are integers. Use grams, millilitres or whole portions as the base unit; decimal-unit conversion is handled by choosing a smaller unit. Money is integer euro cents. Timestamps are UTC milliseconds; operational times are displayed in Europe/Lisbon. Weekly repeats preserve Lisbon local time across daylight-saving transitions. Occurrences are materialized separately; delete and recreate an individual occurrence for an exception. Nonexistent local clock times are rejected.

Inventory invariants: quantity ≥ reserved ≥ 0; ledger sum equals physical quantity; active reservations equal reserved quantities. Price snapshots sum to order totals. `scripts/validate.mjs` checks these invariants, foreign keys and recipe tenant consistency. `npm run backup` creates a consistent database snapshot with VACUUM INTO. Do not copy a live SQLite file without its WAL or without a proper backup operation.

For restoration, stop the application and worker, preserve the current data directory, place a validated backup at the configured DATABASE_PATH, then restart and run validation. Uploaded files and recovery outbox are stored under DATA_DIRECTORY (default `data/`), so include them in backups where appropriate. Keep recovery outbox access restricted.
