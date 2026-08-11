# BrowserNode — WebContainers Alternative (from scratch)

**Goal:** Run Node.js / npm / Vite / Next.js entirely in the browser, with no remote compute server. Core runtime in C/C++ → WebAssembly.

## Why this architecture

StackBlitz WebContainers is a proprietary WASM OS + Node runtime. We cannot clone it; we rebuild the same *capabilities* with an open design:

| Layer | Technology | Role |
|-------|------------|------|
| Kernel | C++ → WASM (Emscripten) | VFS, processes, pipes, signals, virtual TCP |
| JS Engine | QuickJS (C, linked into WASM) | Execute JS/CJS like `node` |
| Node Compat | C++ bindings + JS polyfills | `fs`, `path`, `buffer`, `events`, `stream`, `http`, `net`, `child_process`, `module` |
| Package Mgr | TS host + registry fetch | `npm install` via npm registry / CDN into VFS |
| Networking | Service Worker + MessageChannel | Preview `localhost:port` without real sockets |
| Host API | TypeScript (`@browsernode/api`) | Boot, mount FS, spawn, events — WebContainer-like DX |

## Reality check (honest roadmap)

A *perfect* full Node.js (native addons, all of Next.js SSR edge cases) takes years. This plan ships a **working, extensible** runtime in phases so each phase is usable:

1. **MVP** — `node script.js`, CommonJS `require`, `fs`/`path`/`process`, terminal I/O
2. **Packages** — resolve `node_modules`, install from registry into VFS
3. **Servers** — `http.createServer` + Service Worker preview iframe
4. **Tooling** — `npm` CLI subset, run Vite (esbuild WASM path)
5. **Frameworks** — Next.js (hardest; incremental API coverage)

## Phase plan

### Phase 0 — Toolchain & scaffold ✅
- Emscripten, CMake, Node for host tooling
- Repo layout, build scripts, COOP/COEP demo server

### Phase 1 — WASM Kernel
- In-memory VFS (POSIX-ish: open/read/write/stat/mkdir/readdir/unlink/rename)
- Process table: spawn, exit, stdin/stdout/stderr pipes
- Shared host bridge (`EM_ASM` / `EM_JS` / exported C API)
- Unit tests via native `g++` build of kernel (no browser)

### Phase 2 — QuickJS engine
- Vendor QuickJS sources
- `node` binary = QuickJS + our Node bootstrap
- Eval scripts from VFS; print to process stdout

### Phase 3 — Node.js compatibility
- Core modules implemented progressively (see `runtime/node/MODULES.md`)
- Module loader: CJS `require`, then ESM
- `Buffer`, `EventEmitter`, streams duplex basics
- Timers (`setTimeout`/`setInterval`) wired to browser event loop via Asyncify / proxy

### Phase 4 — Host API
```ts
const bn = await BrowserNode.boot();
await bn.mount({ 'index.js': { file: { contents: 'console.log(1)' } } });
const proc = await bn.spawn('node', ['index.js']);
proc.output.pipeTo(...);
bn.on('server-ready', (port, url) => { iframe.src = url });
```

### Phase 5 — Virtual networking
- Kernel `listen(port)` registers with host
- Service Worker intercepts `/__bn_preview/:port/*`
- Request forwarded into Node `http.Server` callback

### Phase 6 — Package install
- Fetch tarball from `registry.npmjs.org`
- Extract (JS untar/inflate) into VFS `node_modules`
- Resolve package.json `main`/`exports`

### Phase 7 — Vite / Next path
- Prefer Vite first (simpler; esbuild-wasm)
- Next.js: document missing APIs; polyfill iteratively

## Directory layout

```
browsernode/
├── PLAN.md
├── README.md
├── docs/
│   └── ARCHITECTURE.md
├── kernel/                 # C++ WASM OS
│   ├── CMakeLists.txt
│   ├── include/bn/
│   ├── src/
│   └── tests/
├── vendor/
│   └── quickjs/            # git submodule (bellard/quickjs)
├── runtime/
│   ├── node/               # Node polyfills (JS)
│   └── bootstrap.js
├── packages/
│   └── api/                # @browsernode/api (TypeScript)
├── demo/                   # Browser playground
├── scripts/
│   ├── build-kernel.sh
│   └── serve-demo.mjs
└── CMakeLists.txt
```

## Success criteria (MVP)

- [ ] Boot WASM kernel in browser under COOP/COEP
- [ ] Mount a file tree into VFS
- [ ] `spawn('node', ['hello.js'])` prints to terminal
- [ ] `require('fs').writeFileSync` / `readFileSync` work
- [ ] Simple `http.createServer` serves HTML in preview iframe
- [ ] Install a tiny npm package (e.g. `left-pad` / `ms`) into VFS and require it

## Non-goals (v1)

- Native Node addons (`.node` binaries)
- Full POSIX (`fork`, real threads) — cooperative processes only
- Raw TCP/UDP outside HTTP/WebSocket mapping
- Perfect Node version parity (we target Node 20 API surface subset)
