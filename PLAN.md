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
| 10 Next.js | 🔜 | Incremental API coverage |

## Phase 7 — Async / keep-alive processes (detail)

**Done:** `listen()` keep-alive, HttpBridge, `wait === -1`, JS runtime default.

## Phase 8 — Real HTTP preview (detail)

SW ↔ MessageChannel ↔ HttpBridge ↔ Node handler; demo also paints via `srcdoc` fallback.

## Phase 9 — Vite Node API enablers (detail)

1. `require('crypto')`: `randomFillSync`, `randomBytes`, `createHash('sha256')`
2. `process.nextTick` via `queueMicrotask`
3. `require('perf_hooks')`: `performance.now`, no-op `PerformanceObserver`
4. Shared snippets in `packages/api/src/node-polyfills.ts`; mirrored in QuickJS bootstrap

## Phase 10 — Next.js (later)

Incremental API coverage (`async_hooks` stubs, broader `fs`, OPFS cache, …).

## Directory layout

```
browsernode/
├── PLAN.md
├── kernel/
├── vendor/quickjs/
├── runtime/node/
├── packages/api/
│   └── src/
│       ├── http-bridge.ts
│       ├── npm-install.ts
│       ├── esbuild-bundle.ts
│       ├── js-runtime.ts
│       ├── node-polyfills.ts
│       └── …
├── demo/
└── scripts/
```

## Success criteria (current milestone)

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
