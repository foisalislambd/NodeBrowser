# Frequently asked questions

## Does NodeBrowser run on a remote server?

No. The runtime executes in the browser tab (C++/WASM + QuickJS). The optional demo `npm run dev` process only serves static files with COOP/COEP headers.

## Where do npm packages install?

Into the in-memory **VFS** (e.g. `/home/project/node_modules`), not your host disk `node_modules` (except the real apps under `demo/templates/` when you run host Vite/Next).

## Can it run full Next.js / Vite today?

**In-tab subset:** `vite` / `next` kernel commands bundle with **esbuild-wasm** and shims (React/Next App Router client pages). That is not the upstream Vite 8 / `next start` CLIs.

Host templates still exist (`npm run dev:vite` / `dev:next`) for comparison.

## WASM kernel?

`NodeBrowser.boot()` loads **C++ → WASM** and **throws** if the kernel is missing (`npm run build:wasm`). There is no JavaScript guest Node (`js-runtime.ts` was removed). CI builds WASM with Emscripten and runs conformance against that binary.

## Is this a drop-in for StackBlitz WebContainers?

No. `WebContainer` from `@foisal/nodebrowser` / `@foisal/nodebrowser/compat` is a **name shim** over the same C++ kernel (`boot` / `fs` / `mount` / `spawn` / `on` / `teardown`). Extra APIs live on `instance` (`install`, `viteDev`, `importZip`, …). See `PLAN.md` “How we beat WebContainers”.

## Is this a security sandbox?

Best-effort isolation for demos and tooling experiments — not a hardened multi-tenant boundary. See `SECURITY.md`.
