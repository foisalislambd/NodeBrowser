# BrowserNode — WebContainers Alternative (from scratch)

**Goal:** Run Node.js / npm / Vite / Next.js entirely in the browser, with no remote compute server. Core runtime in C/C++ → WebAssembly.

## Architecture (summary)

| Layer | Technology | Role |
|-------|------------|------|
| Kernel | C++ → WASM (Emscripten) | VFS, processes, pipes, virtual ports |
| JS Engine | QuickJS (submodule `vendor/quickjs`) + JS fallback | Execute JS/CJS like `node` |
| Node Compat | Bootstrap + host polyfills | `fs`, `path`, `buffer`, `http`, … |
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
| 9 Next.js | 🔜 | Incremental API coverage |

## Phase 7 — Async / keep-alive processes (detail)

**Problem:** MVP `spawn('node')` runs sync and exits — `listen()` cannot serve later requests.

**Done:**
1. Script calling `server.listen(port)` marks process **Running** (keep-alive).
2. HTTP handler registered in host `HttpBridge` (port → handler).
3. `wait(pid)` returns `-1` until `kill` or `process.exit`.
4. Demo boots the **JS runtime** by default (full HTTP); WASM via `boot({ useWasm: true })`.

## Phase 8 — Real HTTP preview (detail)

```
iframe → GET /__bn_preview/3000/
     → Service Worker
     → postMessage(bn-http-request)
     → page BrowserNode / HttpBridge
     → HttpBridge.dispatch(port, req)
     → Node handler (req, res)
     → bn-http-response → SW → Response
```

Mock IncomingMessage / ServerResponse with `url`, `method`, `headers`, `writeHead`, `end`.

## Phase 9 — fs.promises + Buffer (detail)

- `fs.promises.readFile/writeFile/mkdir/readdir/unlink/stat`
- `Buffer.alloc/from/concat/isBuffer`, basic encoding utf8/base64/hex
- Shared snippets in `packages/api/src/node-polyfills.ts` (+ `runtime/node/`)

## Phase 10 — Solid npm install (detail)

1. Resolve version + `dependencies` recursively (depth-capped).
2. Scoped names `@scope/pkg` → correct registry URL.
3. Memory + `caches` API tarball cache keyed by integrity/version.
4. Install progress events (`bn.on('install-progress', …)`).

## Phase 11 — Vite-ready path (detail)

1. Ship `esbuild-wasm` helper: transform TS/JSX in-browser into VFS.
2. Demo button: “Bundle esbuild” → write `/dist` → static preview via HttpBridge.
3. Full `vite` CLI later (needs more Node APIs + HMR websocket).

## Directory layout

```
browsernode/
├── PLAN.md
├── kernel/                 # C++ WASM OS
├── vendor/quickjs/         # git submodule
├── runtime/node/           # shared Node polyfill notes
├── packages/api/           # @browsernode/api
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

## Non-goals (still)

- Native `.node` addons
- Full POSIX fork/threads
- Raw TCP/UDP
- Perfect Node 20 parity / full Next.js (later)
