# Roadmap

Full detail: [`PLAN.md`](./PLAN.md).

## North star

Open-source **WebContainers-class** runtime in the browser tab — **C/C++ → WASM kernel**, not a JavaScript Node.

Guest Node, VFS, processes, and shell live in the kernel + QuickJS embed. TypeScript is only `boot` / `mount` / `spawn`, npm `fetch`, OPFS, Service Worker, and UI.

## Already in C++/WASM (early)

- C++ → WASM kernel + VFS + spawn + `sh` subset + **kill tree**
- QuickJS `node` + guest modules baked into the kernel
- Service Worker preview; demo **ports** status
- npm install = host **allowlisted** fetch into **kernel VFS**; C++ `npm`/`npx`
- `WebContainer` name shim; ZIP → preview
- Host API over C ABI

## Must add (still C++/WASM)

1. Delete `js-runtime.ts` entirely; WASM job on GitHub Actions  
2. Asyncify / worker so long `node` does not freeze the tab  
3. Real installed `vite`/`tsc` in QuickJS when the graph fits  
4. Optional `@xterm/xterm`; SAB stdio  
5. External bake-off vs WebContainers  

## Non-goals

Native `.node` addons, raw internet TCP, perfect Node parity, a second Node in TypeScript, full Turbopack — see `PLAN.md`.
