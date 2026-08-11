# BrowserNode — WebContainers Alternative (from scratch)

**Goal:** Run Node.js / npm / Vite / Next.js entirely in the browser, with no remote compute server. Core runtime in C/C++ → WebAssembly.

## Architecture (summary)

| Layer | Technology | Role |
|-------|------------|------|
| Kernel | C++ → WASM (Emscripten) | VFS, processes, pipes, virtual ports |
| JS Engine | QuickJS (submodule `vendor/quickjs`) + JS fallback | Execute JS/CJS like `node` |
| Node Compat | Bootstrap + host polyfills | `fs`, `path`, `buffer`, `http`, `crypto`, … |
| Package Mgr | TS host + npm registry | install into VFS (+ deps + cache) |
| Networking | Service Worker ↔ HttpBridge | Preview `/__bn_preview/:port` |
| Host API | `@browsernode/api` | WebContainer-like DX |

## Phase status

| Phase | Status | Deliverable |
|-------|--------|-------------|
| 0 Toolchain | ✅ | Emscripten, CMake, demo COOP/COEP |
| 1 WASM kernel | ✅ | VFS + process + C ABI |
| 2 QuickJS | ✅ | `node` runner + CJS require |
| 3 Node subset | ✅ | fs/path/http/events + **fs.promises / Buffer** |
| 4 Host API | ✅ | `BrowserNode.boot/mount/spawn` |
| 5 Virtual net | ✅ | **Real SW → handler → Response** |
| 6 npm install | ✅ | **deps tree, scoped pkgs, cache** |
| 7 Async process | ✅ | **keep-alive servers + non-blocking spawn** |
| 8 Vite path | ✅ | **esbuild-wasm transform demo** |
| 9 Vite Node APIs | ✅ | **crypto / nextTick / perf_hooks** |
| 10 Next.js APIs | ✅ | **createRequire / async_hooks stubs / broader fs** |
| 11 Next.js app | 🔜 | Run a tiny Next subset later |

## Phase 9 — Vite Node API enablers (detail)

Done: crypto, nextTick, perf_hooks.

## Phase 10 — Next.js incremental APIs (detail)

**Goal:** Unblock packages that import Next-ish Node builtins without full Next yet.

1. `module.createRequire(filename)` → require function bound to that path
2. `async_hooks` stub: `AsyncLocalStorage`, `createHook` no-ops
3. `diagnostics_channel` stub: `channel().subscribe/publish` no-ops
4. Broader `fs`: `constants`, `accessSync`, `realpathSync`, `copyFileSync`
5. Mirror in QuickJS bootstrap

**Out of this slice:** full Next server, OPFS cache, edge runtime split, HMR websocket.

## Success criteria (Phase 10)

- [x] `require('module').createRequire('/x.js')('fs')` works
- [x] `require('async_hooks').AsyncLocalStorage` runs `run()`
- [x] `fs.accessSync` / `realpathSync` / `constants` / `copyFileSync` work
- [x] Smoke test + MODULES.md updated

## Success criteria (prior milestones)

- [x] Boot kernel / JS fallback; mount VFS; run `node`
- [x] `require` + node_modules resolution
- [x] `http.createServer` serves real HTML in preview iframe via SW
- [x] Keep-alive after `listen()` until kill
- [x] `fs.promises` + usable `Buffer`
- [x] `install(['ms'])` pulls transitive deps with cache
- [x] esbuild-wasm can bundle a tiny entry to `/dist`
- [x] `crypto.randomBytes` / `process.nextTick` / `perf_hooks.performance.now`

## Non-goals (still)

- Native `.node` addons
- Full POSIX fork/threads
- Raw TCP/UDP
- Perfect Node 20 parity / full Next.js (later)
