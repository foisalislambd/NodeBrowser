# Roadmap

Full detail: [`PLAN.md`](./PLAN.md).

## North star

Open-source **WebContainers-class** runtime in the browser tab — **C/C++ → WASM kernel**, not a JavaScript Node.

Guest Node, VFS, processes, and shell live in the kernel + QuickJS embed. TypeScript is only `boot` / `mount` / `spawn`, npm `fetch`, OPFS, Service Worker, and UI.

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

## Must add (still C++/WASM)

1. Optional `@xterm/xterm`; SAB stdio  
2. External bake-off vs WebContainers  

## Non-goals

Native `.node` addons, raw internet TCP, perfect Node parity, a second Node in TypeScript, full Turbopack — see `PLAN.md`.
