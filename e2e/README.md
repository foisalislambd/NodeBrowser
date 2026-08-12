# Bake-off (Playwright)

CI runs **NodeBrowser** in Chromium against the demo (`runtime=wasm`).

[WebContainers](https://webcontainers.io/) is proprietary. This repo does **not** vendor `@webcontainer/api` or a StackBlitz token. To compare locally:

1. `npm run build:demo && npm run test:e2e` — writes `e2e/last-run.json`
2. Optionally fill `e2e/wc-placeholder.json` with WC timings from a separate script
3. `node scripts/bakeoff.mjs` — Node-side WASM boot/spawn (no browser) + prints both JSON files

Firefox/WebKit: `npx playwright test --project=firefox` (install browsers first).
