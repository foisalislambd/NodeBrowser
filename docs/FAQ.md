# Frequently asked questions

## Does BrowserNode run on a remote server?

No. The runtime executes in the browser tab (JS fallback and/or WASM). The optional demo `npm run dev` process only serves static files with COOP/COEP headers.

## Where do npm packages install?

Into the in-memory **VFS** (e.g. `/home/project/node_modules`), not your host disk `node_modules` (except the real apps under `demo/templates/` when you run host Vite/Next).

## Can it run full Next.js / Vite today?

Host templates yes (`npm run dev:vite` / `dev:next`). Full CLIs inside the tab are still on the roadmap — see `PLAN.md`.

## WASM vs JS fallback?

`BrowserNode.boot()` defaults to the JS runtime for reliability in the demo. Pass `{ useWasm: true }` when a WASM build is available.

## Is this a security sandbox?

Best-effort isolation for demos and tooling experiments — not a hardened multi-tenant boundary. See `SECURITY.md`.
