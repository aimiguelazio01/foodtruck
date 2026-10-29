# Food Truck Live

A Portuguese (Portugal) food-truck management and guest-ordering web application, using Next.js, React, TypeScript and persistent SQLite. Includes three fictional businesses, owner/manager/staff accounts, digital menus, a cart with extras and sizes, pickup scheduling, protected tracking, kitchen operations, inventory, calendar, locations, customer tools, branding and reports.

## Run locally

Requires **Node.js 24** and npm. No PostgreSQL, Docker, payment account or API key is needed for local use.

```sh
npm ci
npm run setup
npm run seed
npm run dev
```

Open **http://localhost:3000**. Public menus: `/b/urban-burger`, `/b/bella-pizza`, `/b/green-bowl`. Management: `/login`.

Demo accounts use the password **DemoFoodTruck2026!**:

- `owner@urban-burger.demo`
- `manager@urban-burger.demo`
- `staff@urban-burger.demo`

Replace `urban-burger` with `bella-pizza` or `green-bowl` for the other businesses. Seed records are fictional. Normal changes persist in `data/foodtruck.sqlite`.

## Production-mode local run

```sh
npm run build
npm start
```

Run `npm run worker` in another terminal for pending-order expiry, session cleanup and contact retention. The app also expires pending orders on operational requests. Configure `APP_URL` before downloading QR codes. Offline public-menu fallback is enabled in the production build; it never queues orders or staff mutations.

## Verification

```sh
npm test
node --env-file-if-exists=.env.local scripts/validate.mjs
npm run build
npm run test:e2e
npm run backup
```

Playwright uses its own `data/e2e.sqlite` database and port 3100. Install a browser if necessary with `npx playwright install chromium`. Test data must never point at a production database. Browser reports are generated in `playwright-report/`.

## New business without demo content

Run setup, then `node scripts/create-business.mjs my-truck "My Food Truck"`. Set the `FOODTRUCK_ADMIN_PASSWORD` environment variable to a unique password of at least 12 characters and run `node scripts/create-user.mjs owner@example.com my-truck`. Clear the variable afterwards. Sign in, create ingredients and products, add recipes, create public operating sessions, and publish the truck as open. A new business starts closed.

## Important operating rules

- Pickup slots are 15 minutes, limited to five orders by default and published public sessions. The lead time respects menu preparation estimates.
- Checkout reserves ingredients. Preparation deducts them exactly once. Earlier cancellation releases them; later cancellation records consumed ingredients as waste.
- Orders expire after 15 minutes without confirmation.
- Prices, option eligibility, availability, stock and pickup capacity are checked on the server. Checkout retries use a persistent secret key.
- Tracking requires an HttpOnly secret cookie; an order number or URL alone does not authorize access.
- Collection payments are manually recorded. Demonstration payments are explicitly simulated and reported separately from collection receipts. No card data or real payment processor is connected.
- Password reset messages are written to the server-private `data/outbox` directory. Automated email delivery is an external integration to configure.

See the architecture, features, database, testing and deployment documents in `docs/`. SQLite deployment requires one server and a persistent local disk. Real hosting, payment processing, email delivery and certified fiscal invoicing are not activated by this project.
