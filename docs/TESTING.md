# Testing

## Automated domain/database suite

Run `npm test`. The suite currently contains 16 tests covering authentication, password recovery/revocation, tenant/role permissions, catalog persistence, repeatable seeding, order state transitions, authoritative price/customization snapshots, required modifier cardinality, simulated payments, inventory reserve/consume/release/waste, final-unit contention using independent worker-thread database connections, pickup capacity, pending expiry and Lisbon DST recurrence.

Run `node --env-file-if-exists=.env.local scripts/validate.mjs` to check database integrity, foreign keys, order totals, physical-stock ledger, reservation ledger and tenant recipe consistency. These checks passed on the local seeded database. A real VACUUM INTO backup was also created successfully.

## Browser suite

Run `npm run build` then `npm run test:e2e`. Tests use an isolated `data/e2e.sqlite` database, initialize demo data, start the packaged production server at port 3100, and shut it down after the run. Both Chromium and Firefox projects are configured. Install browser binaries with `npx playwright install chromium firefox` when needed.

Seven scenarios per browser:

1. Guest customizes burger, adds fries, chooses pickup, checks out; owner processes through ready/payment/collected; customer sees automatic updates.
2. Owner edits branding and uploads a logo, publishes location, verifies public persistence and business-isolated CSV export.
3. Staff cannot access branding or financial exports and see only operational navigation.
4. Mobile viewport has no horizontal overflow; axe accessibility scan includes contrast; offline navigation shows either the timestamped saved-menu fallback or the retained public menu with an explicit offline warning and disabled checkout.
5. Owner creates a product, uploads a raster image, creates/restocks an ingredient, associates its recipe, and verifies public availability/image delivery.
6. Owner configures required meal choices; customer selects a double portion and required option, and the correct price/customization reaches the saved order.
7. Every management section renders without application errors; calendar day/week controls, blank-date handling and public QR delivery work.

The final run passed all fourteen scenarios across Chromium and Firefox after a clean installation and production build. Browser emulation is not physical iPhone/Android verification. Docker, Safari/WebKit and real-device coverage must be reported separately.

## Manual checks

Use the three fictional logins to inspect every management section. Test denied geolocation, external tile failure and manual coordinates. Offline staff writes must not be represented as queued. Check 320px, 375px, tablet and desktop widths. Backups must be restored and validated on a separate path before relying on recovery.

## Performance

The menu uses thirty individual transparent WebP images, with lazy loading and no unstable image hotlinks. Map code loads dynamically, large static images are locally cached, and private pages remain dynamic. Record browser timing conditions when measuring performance; local timings are not mobile-network field measurements. No unsupported Lighthouse or real-world Core Web Vitals score is claimed.



## Final local viewport and timing check
The production storefront was checked at 320, 375, 768 and 1440 CSS pixels; none had horizontal overflow. One local Chromium navigation measured DOMContentLoaded at 193 ms and load at 284 ms. These are warm local-host observations, not throttled-mobile LCP/INP measurements or field Core Web Vitals. Actual storefront/dashboard screenshots are saved under docs/screenshots/.


## Product image update
All 30 new files were checked for alpha transparency and at least 900 pixels in each dimension. The three storefronts each loaded ten images without broken references in the production browser. Chromium and Firefox targeted mobile accessibility/offline and uploaded-image scenarios passed (4 tests).
