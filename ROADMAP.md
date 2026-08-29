# Roadmap

See also [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## North star

Open-source **WebContainers-class** runtime in the browser tab — **C/C++ → WASM kernel**, not a JavaScript Node.

Guest Node, VFS, processes, and shell live in the kernel + QuickJS embed. TypeScript is only `boot` / `mount` / `spawn`, npm `fetch`, OPFS, Service Worker, and UI.

## Language law

- **Kernel / guest Node:** C++ and the QuickJS embed (`kernel/`, `kernel/embed/guest_modules.js`). New Node modules go there, not in the host package.
- **Host (`@foisal/nodebrowser`):** TypeScript only — WASM load, npm registry fetch, OPFS, Service Worker, bundler shims.
- **Demo UI:** JavaScript under `demo/src` (Vite; no parallel `.ts` sources).

## Already in C++/WASM (early)

- C++ → WASM kernel + VFS + spawn + `sh` subset + **kill tree**
- QuickJS `node` + guest modules baked into the kernel
- Browser: WASM kernel on a **Worker** (UI thread stays responsive)
- Kernel **event loop** (`setTimeout`/`setInterval` + `bn_pump`); guest `fetch` deny + localhost virtual HTTP
- Cooperative `worker_threads.Worker`; `vm` extra JSContext; C++ tar extract; VFS 512 MiB cap
- Service Worker preview; demo **ports** status
- npm install = host **allowlisted** fetch into **kernel VFS**; C++ `npm`/`npx`
- `WebContainer` name shim; ZIP → preview
- Host API over C ABI
- WASM-only `boot()` (no TypeScript guest Node); PR CI builds kernel with Emscripten
- Installed `tsc` / `vite` CLIs in QuickJS (vite falls back to esbuild-wasm when native esbuild is required)
- `@xterm/xterm` demo terminal; SAB stdio rings (Worker + COOP/COEP); Playwright Chromium bake-off

## Must add (still C++/WASM)

1. Real installed `vite`/`tsc` graph coverage (Microsoft tsc.js still may miss APIs)
  2. WC-speed install cache

## Non-goals

Native `.node` addons, raw internet TCP, perfect Node parity, a second Node in TypeScript, full Turbopack — see `ROADMAP.md`.
