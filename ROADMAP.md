# Roadmap

Full detail: [`PLAN.md`](./PLAN.md).

## North star

Open-source **WebContainers-class** runtime in the browser tab — **C/C++ → WASM kernel**, not a JavaScript Node.

Guest Node, VFS, processes, and shell live in the kernel + QuickJS embed. TypeScript is only `boot` / `mount` / `spawn`, npm `fetch`, OPFS, Service Worker, and UI.

## Already in C++/WASM (early)

- C++ → WASM kernel + VFS + spawn + `sh` subset  
- QuickJS `node` + guest modules baked into the kernel  
- Service Worker preview  
- npm install = host fetch into **kernel VFS**  
- Host API over C ABI  
- Demo file manager / terminal line → `sh -c`

## Must add (still C++/WASM)

1. **Delete JS guest** (`js-runtime.ts` freeze → remove) — WASM is the only `node`  
2. Harden WASM HTTP keep-alive and process model  
3. Vite **in-tab** via WASM `node` + HMR  
4. Next subset **in-tab** on WASM  
5. xterm + multi-port preview (**UI only**)  
6. WebContainer API name shim (same kernel)  
7. Benchmarks vs WebContainers  

## Non-goals

Native `.node` addons, raw internet TCP, perfect Node parity, a second Node in TypeScript, full Turbopack — see `PLAN.md`.
