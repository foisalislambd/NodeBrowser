# Frequently asked questions

## Does NodeBrowser run on a remote server?

No. The runtime executes in the browser tab (C++/WASM + QuickJS). `npm run dev` is a Vite server with COOP/COEP headers (needed for SharedArrayBuffer). GitHub Pages uses the same Vite build with [`vite-basepath`](https://www.npmjs.com/package/vite-basepath) so assets work under `/NodeBrowser/`.

## Where do npm packages install?

Into the in-memory **VFS** (e.g. `/home/project/node_modules`), not your host disk `node_modules` (except the real apps under `demo/templates/` when you run host Vite/Next). Terminal `npm install` is the same installer (`bn.install`). See [NPM.md](./NPM.md) and [GUIDE.md](./GUIDE.md).

## Does Tailwind work like on a PC?

**Install:** yes — `npm install tailwindcss @tailwindcss/browser` writes into the project VFS. **CLI:** `npx tailwindcss -i … -o …` is intercepted on the host (native oxide/lightningcss cannot run in WASM). **Utilities:** applied in Simple Browser via `@tailwindcss/browser`. Details: [TAILWIND.md](./TAILWIND.md).

## Can it run full Next.js / Vite today?

**In-tab subset:** `vite` / `next` kernel commands bundle with **esbuild-wasm** when the installed CLI graph does not fit QuickJS (native `esbuild`). `spawn('tsc')` runs installed `typescript/lib/tsc.js` in QuickJS. `spawn('vite')` tries `node_modules/vite/bin/vite.js` first, then the host subset. That is not bit-identical to Vite 8 / `next start`.

Host templates still exist (`npm run dev:vite` / `dev:next`) for comparison.

## WASM kernel?

`NodeBrowser.boot()` loads **C++ → WASM** and **throws** if the kernel is missing (`npm run build:wasm`). There is no JavaScript guest Node (`js-runtime.ts` was removed). CI builds WASM with Emscripten and runs conformance against that binary.

## Is this a drop-in for StackBlitz WebContainers?

No. `WebContainer` from `@foisal/nodebrowser` / `@foisal/nodebrowser/compat` is a **name shim** over the same C++ kernel (`boot` / `fs` / `mount` / `spawn` / `on` / `teardown`). Extra APIs live on `instance` (`install`, `viteDev`, `importZip`, …). See [`ROADMAP.md`](../ROADMAP.md).

## Is this a security sandbox?

Best-effort isolation for demos and tooling experiments — not a hardened multi-tenant boundary. See [`SECURITY.md`](../SECURITY.md).
