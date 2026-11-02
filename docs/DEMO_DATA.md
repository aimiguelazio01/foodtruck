# Demonstration data and assets

`npm run seed` creates Urban Burger Truck, Bella Pizza Mobile and Green Bowl Street Food, with ten named menu products each. Each business has 24 seeded orders, 15 fictional customer contacts, three accounts (owner/manager/staff), ten product-portion inventory items, an extras item and ten named ingredient items, recipes, suppliers, stock movements, public/private operating events and operational tasks. Additional orders made during testing are persisted normally. Seeds use relative dates when first created and preserve user edits on later runs.

Demo accounts: owner, manager or staff at `<business-slug>.demo`; password `DemoFoodTruck2026!`. Demo identities and contact domains are fictional. Set DEMO_MODE=0 and create unique accounts for any non-demo installation. Production seeding requires ALLOW_DEMO_SEED=1 and must be restricted to an isolated demonstration environment.

## Original generated photography

Two images were created with the built-in image generation tool, then optimized locally with sharp. They are AI-generated illustrations of fictional food and trucks, not photographs of actual businesses.

- `public/images/food-atlas.png` is the retained original 5×6 food image atlas. `food-atlas.webp` is its optimized archival copy. The current application uses the individual transparent product images documented below.
- `public/images/trucks.png` is the retained original three-panel fictional truck image; `trucks.webp` is optimized for the site. Panels are charcoal/orange burger, deep-red pizza and forest-green bowl trucks.
- The app icon is an original SVG text mark; 192/512 PNG versions are generated locally.

Food prompt: professional photorealistic food contact sheet, exactly five columns and six rows, no text/gutters, warm side lighting, charcoal background, dishes listed in the seed's product order. Truck prompt: three equal-width photorealistic panels of fictional charcoal/orange burger, red/cream pizza and forest-green bowl trucks in Lisbon settings, no text or identifiable people.

No stock-photo licenses or third-party image hotlinks are used. Font styles use Google Fonts when available with system fallbacks. Leaflet/QR libraries retain their package licenses; maps show OpenStreetMap attribution. Review applicable provider usage terms before production traffic.

## Transparent product image update

The previous atlas is retained as an archived source asset but is no longer used for menu product rendering. Thirty separate AI-generated product photographs are stored as `public/images/products/0.webp` through `29.webp` in the existing seed order. Each was generated with the built-in image-generation tool using the prompt: "Photorealistic premium commercial food product photograph of [dish], isolated completely on a genuinely transparent background, entire item visible with comfortable empty margin on every side, no cropped edges, no plate or props, no words, no logo, natural appetizing texture and soft studio lighting, centered composition, high resolution." The resulting originals were converted to WebP without resizing, preserving alpha. All images have both dimensions at least 900 pixels and a transparent alpha channel. Product cards and user uploads use object-fit: contain to avoid stretching or cropping.

