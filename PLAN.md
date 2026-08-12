# NodeBrowser — Master Plan

**North star:** Become the most capable open-source **WebContainers-class** runtime — run real Node tooling (`npm`, Vite, Next subset, tests, monorepos) **entirely in the browser tab**, with no remote compute VM.

**The product is C and C++ compiled to WASM.** Guest Node, VFS, processes, shell, HTTP keep-alive, and core modules live in the **C++ kernel + embedded QuickJS**. TypeScript/JS is **not** a second runtime. It is only the **host API and UI**.

---

## Language law (non-negotiable)

This is the whole system. Do not grow a parallel Node in browser JS.

| Layer | Language | Owns | Forbidden |
| ----- | -------- | ---- | --------- |
| **Kernel** | **C / C++ → WASM** (Emscripten) | VFS, processes, pipes, ports, spawn, shell builtins, C ABI (`bn_*`) | Reimplementing this in TS |
| **Guest Node** | **C++ + QuickJS** (`kernel/embed/guest_modules.js` baked into `generated_guest_modules.hpp`) | `require`, ESM rewrite, `fs`/`http`/`stream`/`crypto`/… as Node sees them | New guest features in `packages/api/src/kernel/js-runtime.ts` |
| **Host API** | TypeScript (`@foisal/nodebrowser`) | `boot` / `mount` / `spawn` / events; load WASM; call C ABI | Guest semantics, shell, Node modules |
| **Browser bridges** | TypeScript | Service Worker HttpBridge, OPFS persist, `fetch` to npm registry, esbuild-wasm glue | Treating fetch/OPFS as “the Node runtime” |
| **Demo / docs UI** | JS/HTML/CSS | Editor, terminal chrome, preview iframe | Runtime behavior |

**Why C/C++ only for the guest**

- One authoritative runtime. Dual JS+C++ Node doubles cost and diverges forever.
- WebContainers-class depth (binary VFS, process trees, keep-alive HTTP, real `npm` scripts) needs a kernel, not a second interpreter in the page.
- QuickJS is **inside WASM**, not a host-JS Node. Guest JS source in `guest_modules.js` is **embed data for the C++ kernel**, not the product API.

**What JS is allowed to do**

- Load `browsernode_kernel.wasm` and call exported `bn_*`.
- Map browser APIs the kernel cannot own: `fetch` (npm tarballs), OPFS, Service Worker, DOM.
- Demo chrome and the public `NodeBrowser` class.

**What JS must never do again**

- Implement guest `fs` / `http` / `child_process` / `require` as the product path.
- Add features only to `js-runtime.ts`.
- Treat “conformance on `useWasm: false`” as the definition of done. **Done = C++/WASM.**

---

## How we beat WebContainers (not copy them)

WebContainers win on **V8-class JS speed**, mature Vite/npm in-tab, and polished DX. NodeBrowser cannot win by cloning proprietary internals or by growing a second Node in TypeScript.

**We win on:** an auditable **C++/WASM kernel**, honest subset docs, in-tab ZIP→preview, agent-friendly host API, and features WC does not give you as open source.

### Production v1 (this plan’s ship bar)

Done means these work on the **WASM kernel** (native `bn_*_test` + browser demo), not only JS fallback:

| Bar | Status |
| --- | ------ |
| Guest `node` / VFS / spawn / `sh` in C++ | ✅ |
| Process **kill tree** (`parent_pid` + `bn_kill` descendants) | ✅ |
| Host `fetch` **egress allowlist** (npm registry HTTPS only) | ✅ |
| C++ `npm install` / `npm run` / `npx` → host fetch + kernel VFS/spawn | ✅ |
| `WebContainer` name shim (same kernel) | ✅ |
| ZIP import → detect → in-tab preview | ✅ |
| In-tab Vite/Next **subset** (esbuild-wasm + shims, not upstream CLIs) | ✅ subset |
| `SECURITY.md` + WASM-only guest | ✅ |
| WASM-only guest (no `js-runtime.ts`) | ✅ Phase 13b |
| Real `node node_modules/vite/bin/vite.js` in QuickJS | ✅ try CLI; native esbuild → host subset |
| Real `tsc` (`typescript/lib/tsc.js`) in QuickJS | ✅ when installed in VFS |
| xterm / SAB stdio / WC-speed install | Phases 32, 37 — remaining |

### Must-have to actually surpass WC (later pillars)

1. **WASM is the only guest** — Phase 13b. Dual runtimes are a product lie.
2. **Real tooling in WASM** — installed `tsc`/`vite` via QuickJS when the graph fits; esbuild-wasm is the Vite fast path (never pretend a failed CLI is upstream Vite).
3. **Process + HTTP harden** — kill tree ✅; WASM **Worker** so long `node` does not freeze the tab ✅ (same-thread fallback; not Asyncify); HTTP on retained WASM handlers.
4. **Install speed** — OPFS tarball cache, lockfile skip, fewer host copies (Phase 23/37).
5. **Open audit** — CI green = native C++ tests + WASM boot, not `useWasm: false`.
6. **Agent API** — `boot` / `fs` / `spawn` / `install` / `ports` / `killTree` without the demo (Phase 36; host class exists).
7. **DX** — xterm, multi-port UI, snapshot links (Host only).

### Explicit non-goals (do not stall v1)

Bit-identical Node, native `.node` addons, full Turbopack, compiling Node+V8, multi-tenant malware sandbox, matching WC proprietary speed on day one.

---

**JS guest deleted (Phase 13b)** — `js-runtime.ts` is gone. `boot({ useWasm: false })` throws `WASM kernel required`. CI builds C++ → WASM (Emscripten) and runs conformance on that binary.

---

## Architecture (target = current direction)

```
Browser tab (UI thread)
  Demo UI  ──►  @foisal/nodebrowser (TS host)
                    │  postMessage RPC (browser Worker)
                    ▼
              WASM Worker  ──►  browsernode.wasm
                VFS │ Process table │ Shell builtins
                QuickJS + guest_modules (Node subset)
                    │  server-ready / http dispatch
                    ▼
              Service Worker preview  /  OPFS (host flush)

Node / Worker-unavailable: same-thread WASM (tab may freeze on long `node`).
```

| Piece | Tech | Role |
| ----- | ---- | ---- |
| Kernel | C++ → WASM | Source of truth |
| JS engine | QuickJS **in WASM** | Run user/tooling JS like `node` |
| Node compat | `kernel/embed/guest_modules.js` + C++ ABI | Core modules |
| Shell | C++ `cmd_sh` + builtins | `sh -c`, pipes, redirects, `.bin` PATH |
| npm fetch | Host TS `fetch` + extract into **kernel VFS** | Registry is a browser API; install result is C++ VFS |
| Network | Kernel ports + host SW | Preview `/__bn_preview/:port` |
| Host API | `@foisal/nodebrowser` | WebContainer-like DX only |
| Demo | Vanilla UI | Not the runtime |

Details: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) · Module matrix: [`runtime/node/MODULES.md`](./runtime/node/MODULES.md)

**npm note:** downloading tarballs uses host `fetch` because the browser owns the network. Unpacking, `node_modules`, `.bin` resolution, and `npm run` / lifecycle **execution** are kernel (`spawn` / `sh` / `node`). Do not move package *execution* into TS.

---

## WebContainers parity — C++ kernel vs their WASM OS

StackBlitz WebContainers = WASM micro-OS + Node-in-tab + VFS + virtual network + DX.  
NodeBrowser matches that **shape** only if the guest is C++/WASM. A JS-in-page Node is not a WC alternative.

### Side-by-side

| Capability | WebContainers | NodeBrowser (C++/WASM) | Next work |
| ---------- | ------------- | ---------------------- | --------- |
| WASM kernel | Mature micro-OS | C++→WASM kernel ✅ (early) | Harden 16–18, delete JS guest |
| In-memory VFS | ✅ | ✅ C++ VFS | — |
| Persist | Strong | ✅ OPFS via **host** flush of kernel VFS | Incremental C++-driven flush |
| `boot` / `mount` / `spawn` | ✅ | ✅ host API over C ABI | Phase 41 shim ✅ |
| Terminal | xterm | Demo input → kernel `sh -c` | Phase 32 UI only |
| `npm install` | Fast | Host fetch (allowlisted) → kernel VFS; C++ `npm` command | Cache/speed Phase 37 |
| `npm run` / `npx` / `.bin` | ✅ | ✅ kernel PATH + C++ `npm`/`npx` + host fetch | Harden lifecycle |
| Shell | ✅ | ✅ C++ `cmd_sh` subset | More POSIX in C++ |
| ESM | ✅ | ✅ QuickJS guest rewrite | Harden in embed, not TS |
| `fs.watch` | ✅ | ✅ C++ + host events | — |
| Vite in-tab | ✅ | **Subset** esbuild-wasm + C++ `vite` | Real CLI in QuickJS later |
| Next in-tab | subset | **Subset** App Router client bundle | Phase 31 |
| Keep-alive HTTP | ✅ | ✅ retained QuickJS in WASM | Drop JS HttpBridge-as-server |
| Guest modules | ✅ | **Only** C++ embed | — |
| Multi-port UX | ✅ | Status bar ports + iframe | Phase 34 polish |
| COOP/COEP / SAB | Used | Demo local | Phase 37 kernel stdio |
| Install cache | Optimized | Host memory/Cache API + egress policy | Kernel-visible cache index |
| API compat | Native | `WebContainer` shim ✅ | Document deltas |
| Kill / process tree | ✅ | ✅ C++ `parent_pid` + `kill_tree` | Asyncify |
| Open source | Partial | ✅ MIT kernel+API | Keep honest docs |

### Must-add backlog (always implement in C++/QuickJS unless marked Host)

#### A. Disk

- [x] OPFS persist — **Host** flush of C++ VFS (Phase 14)
- [x] Symlinks + binary + `fs.watch` — **C++ VFS** (Phase 15)
- [x] Shareable snapshot links — Host download of kernel tar (Phase 35 MVP)

#### B. Node + npm (kernel)

- [x] ESM / `import` / `node:` — **QuickJS embed** (Phase 20)
- [x] `.bin` PATH, `npm run`, `npx` — kernel spawn + thin host wrappers (Phases 23–24)
- [x] Shell subset — **C++ `cmd_sh`** (Phase 25)
- [x] stdin / tty stubs / `wait` — kernel (Phase 16)
- [x] Process kill tree — **C++** `parent_pid` + `kill_tree` (Phase 16)
- [x] Delete JS guest — WASM-only `boot`; CI Emscripten job (Phase 13b)

#### C. Network (kernel)

- [x] WASM HTTP keep-alive MVP — retained QuickJS (Phase 18)
- [x] Host npm `fetch` egress allowlist (Phase 39 MVP)
- [x] Parity: default boot does not use JS as a supported Node (Phase 18 / 13b)
- [x] Multi-port status in demo — **Host** (Phase 34 MVP)
- [x] Network log (OUTPUT tab) — **Host** (Phase 34 MVP)

#### D. Apps in-tab (must boot on WASM)

- [x] Vite + HMR in-tab **subset** (Phases 27–28)
- [x] Next subset in-tab (Phases 29–30)
- [x] Express-shaped demo (`http.createServer` template) after HTTP keep-alive

#### E. DX (Host UI only)

- [x] Terminal chrome: tabs + command palette + fit CSS (Phase 32 MVP; not the xterm.js npm package)
- [x] File search / templates gallery (Phase 33 MVP)
- [x] `WebContainer` API shim (Phase 41) — names only, same WASM kernel
- [x] Docs honesty: PLAN / FAQ / SECURITY (Phase 40 MVP)

#### F. Open-source win

- [x] Headless host API (`NodeBrowser` / `killTree` / `ports`) — Phase 36 MVP
- [x] JSON-RPC wrapper (Phase 36) — `bn.rpc` / `handleAgentRpc`
- [x] Native `bn_*_test` on every PR (Phase 38)
- [x] VFS path fuzz in `bn_vfs_test` (Phase 38 MVP)
- [x] Benchmarks script `scripts/bench.mjs` (Phase 37 MVP — local timings, not WC bake-off)
- [x] npm cache hit/miss metrics on install-progress (Phase 37)
- [ ] Auditable WASM boot in GitHub Actions (needs Emscripten on CI)
- [ ] SAB + Atomics stdio / Asyncify (Phase 16/37 remainder)

### Explicit “not copying WC”

Do **not** block on: proprietary WC internals, bit-identical Node, native `.node` addons, full Turbopack, multi-tenant cloud sandbox.

Do **not** “catch up” by writing more Node in `js-runtime.ts`.

---

## Completed phases (0–13) — kernel first

| Phase | Status | Deliverable (C/C++ unless noted) |
| ----- | ------ | -------------------------------- |
| 0 Toolchain | ✅ | Emscripten, CMake, demo COOP/COEP |
| 1 WASM kernel | ✅ | C++ VFS + process + C ABI |
| 2 QuickJS | ✅ | C++ `node` runner + CJS require |
| 3 Node subset | ✅ | Guest modules in WASM embed |
| 4 Host API | ✅ | TS `boot/mount/spawn` **over ABI** |
| 5 Virtual net | ✅ | SW → kernel/handler |
| 6 npm install | ✅ | Host fetch; files in kernel VFS |
| 7 Async process | ✅ | Keep-alive in kernel |
| 8 Vite path | ✅ | Host esbuild-wasm glue (bundler is WASM) |
| 9 Vite Node APIs | ✅ | crypto / nextTick / perf in **guest embed** |
| 10 Next.js APIs | ✅ | createRequire / stubs in **guest embed** |
| 11 Vite/Next demos | ✅ | Templates (UI); run target = WASM `node` |
| 12 File manager DX | ✅ | Host UI |
| 13 WASM default | ✅ | `useWasm: true`; JS guest deleted |

Historical note: some checkboxes were first proven on a JS fallback. That does **not** make JS the product. Re-verify every guest feature on `bn_node_test` + WASM boot.

---

## Future roadmap — C/C++ kernel, host stays thin

Phases ordered by dependency. **Exit criteria = works in C++/WASM**, not in `useWasm: false`.

Estimate bands: S ≤ 1–2 weeks, M ≈ month, L multi-month (small team).

### Pillar 0 — Kill the JS guest (do this while shipping)

#### Phase 13b — WASM-only guest `M` ✅

- [x] `js-runtime.ts` **deleted** (stub `createJsFallbackKernel()` throws)
- [x] Default `useWasm: true` throws if WASM missing
- [x] `useWasm: false` throws (`WASM kernel required`)
- [x] Conformance requires `runtime === 'wasm'`
- [x] GitHub Actions: Emscripten C++ → WASM, then API conformance + demo

**Exit:** demo and tests never need a guest Node written in TypeScript.

---

### Pillar A — Runtime foundation (C++)

#### Phase 13 — WASM default `M` ✅ (host surface)

- [x] Host `bn.fs` over C ABI (`exists` / `stat` / `rm` / `rename`)
- [x] Binary `readBytes` / `writeFile` bytes
- [x] `process.env` from `spawn` env_json in **node_runner**
- [x] Default `useWasm: true`
- [x] `bn.runtime` `'wasm' | 'js'` — `'js'` is legacy
- [x] `bn_http_dispatch` + retained QuickJS handlers

**Done:** Phase 13b (JS guest deleted).

#### Phase 14 — Persistent VFS `M` ✅

Host OPFS is a **cache of C++ VFS**, not a second filesystem.

- [x] `boot({ persist: true })` hydrate/flush `/home`
- [x] Snapshot tar export/import
- [x] Incremental OPFS flush of dirty `/home` paths (host flusher)

**Exit:** refresh → `/home/project` still there.

#### Phase 15 — Binary + symlink + watch `M` ✅

- [x] Binary blobs in **C++ VFS**
- [x] `symlink` / `readlink` / `lstat` C ABI + guest `fs`
- [x] `fs.watch` → host `fs-change`
- [x] `chmod` / `utimes` on C++ VFS

**Exit:** editor save → watch events from kernel.

#### Phase 16 — Process model 2.0 `L` ✅ (C++ MVP) / harden in C++

- [x] Kernel spawn: `node`, `sh`, coreutils
- [x] Isolated cwd/env; shared VFS
- [x] stdin + `tty`/`readline` stubs in **guest embed**
- [x] `kill` → 137
- [x] Process groups / kill tree in **C++** (`parent_pid`, `kill_tree`; `bn_kill` is tree)
- [x] `sh -c '… &'` / `wait` MVP
- [x] Max procs limit
- [x] WASM **Worker** so long `node` does not block the tab (browser; same-thread fallback)

**Exit:** parent `node` spawns child `node` inside WASM; `wait` is `-1` while HTTP keep-alive.

---

### Pillar B — Node compatibility (QuickJS embed + C++ ABI only)

All module work: `kernel/embed/guest_modules.js` + `scripts/gen-guest-modules.sh` + C++ `__bn.*` bindings. **Never** `js-runtime.ts`.

#### Phase 17 — Streams & Buffer `M` ✅ (embed)

- [x] Readable/Writable/Transform/Duplex + `pipe`
- [x] `buffer`, `util.promisify`, `string_decoder`, `timers/promises`

#### Phase 18 — Network stack `L` ✅ (MVP in WASM)

- [x] `net` / `http` / `https` stub over virtual ports
- [x] Chunked write/end; upgrade stub
- [x] `bn_http_dispatch` + retained handlers
- [x] Guest `fetch` global rejects raw internet (virtual HTTP / host npm allowlist)
- [x] Default boot does not treat JS as a supported Node runtime

#### Phase 19 — Crypto / zlib `M` ✅ (embed + C++ where hashing lives)

- [x] sha1/256/384/512; zlib sync + streams in guest
- [ ] Optional: move hot hash/zlib to C for speed

#### Phase 20 — ESM + CJS `L` ✅ (embed MVP)

- [x] `import`/`export` rewrite-to-CJS in QuickJS bootstrap
- [x] `import.meta.url`, dynamic `import()`, `exports` field, `node:`
- [x] `next/cache` / `next/headers` stubs in **embed** when package not installed

#### Phase 21 — Workers & VM `L` (C++ / WASM Workers — stubs today)

- [x] Stubs in embed (`worker_threads.Worker` throws; `vm` same-realm)
- [x] Cooperative `worker_threads.Worker` (same-thread QuickJS; not SAB)
- [ ] MessagePort for HMR — kernel or host bridge, not a JS Node
- [x] `vm`: additional QuickJS `JSContext` in C++ (`__bn.evalNewContext`)

#### Phase 22 — Builtins matrix `M` (ongoing, embed)

- [x] `child_process` → kernel spawn; `cluster`/`dns`/`dgram`/`inspector`/`v8`/`wasi` stubs
- [x] `createReadStream` / `createWriteStream` / `opendir` / `rmdir` / `mkdtemp`
- [x] Fill MODULES.md gaps for Next cache/headers stubs **in embed**

**Pillar B exit:** Vite scaffold packages `require()` without missing-module crashes **on WASM**. Stubs OK if documented.

---

### Pillar C — Package manager & shell

**Execute in C++. Host only fetches bytes.**

#### Phase 23 — npm 2.0 `M` ✅ (MVP) / move more into kernel

- [x] Host: lockfile generate, peer warn, optional skip, bin shims, lifecycle allowlist, AbortSignal
- [x] Kernel: `.bin` on `spawn` PATH
- [x] `npm` / `npx` as **C++ commands** (parse argv; host only for registry GET)
- [x] Lifecycle scripts `kernel.spawn("sh")` with host allowlist
- [x] Registry Cache API + memory cache metrics (host)
- [x] Scoped registry URLs (`%2F`)
- [x] Optional: C++ tar extract (`Vfs::extract_tar` / `bn_vfs_extract_tar`); gzip still host `DecompressionStream`

#### Phase 24 — npx / runners `M` ✅ (MVP)

- [x] Host `npx` / `runScript` → kernel `spawn`
- [x] Local `.bin/vite` etc. via C++ PATH
- [x] `npm` / `npx` as **C++ commands** (parse argv in kernel; host only for registry GET)

#### Phase 25 — Shell `M` ✅ (C++ MVP)

- [x] C++ `cmd_sh`: `|`, `&&`, `||`, `;`, redirects, env, `cd`/`export`
- [x] Builtins: `pwd` `echo` `which` `ls` `cat` `mkdir` `rm` `cp` `mv`
- [x] Demo line → `spawn('sh', ['-c', line])`
- [x] More POSIX in **C++**: glob `*`/`?`, `test`/`[` `-f`/`-d`/`-e`
- [x] Terminal chrome is Phase 32 (**Host**); PTY semantics stay kernel

#### Phase 26 — Alternate lockfiles `S–M` ✅ (MVP)

- [x] Detect pnpm/yarn lock — warn on `install`; npm still extracts into kernel VFS
- [x] `corepack` stub in **embed** (does not run yarn/pnpm)

---

### Pillar D — Vite in the browser (kernel VFS + esbuild-wasm)

Upstream `vite` CLI needs native `esbuild`. In-tab Vite **tries** `node_modules/vite/bin/vite.js` in QuickJS; if the graph does not fit (native addon / esbuild), it falls back to host esbuild-wasm. `tsc` runs installed `typescript/lib/tsc.js` in QuickJS.

#### Phase 27 — Vite platform APIs `M` ✅ (MVP)

- [x] `fs.watch` (Phase 15, C++)
- [x] HTTP upgrade / WebSocket: guest `ws` stub + HMR **reload** via `__hmr_gen` poll
- [x] `esbuild` in a Worker — host `esbuild-wasm` `{ worker: true }` in browser
- [x] `connect`-style middleware — guest `connect` stub → `http.createServer`

#### Phase 28 — In-tab `vite` / `vite build` `L` ✅ (subset)

- [x] `vite` / `vite build` — try installed CLI in QuickJS; else host `__bn_on_tool` → `viteDev` / `viteBuild`
- [x] `tsc` — installed `typescript/lib/tsc.js` in QuickJS (shebang + argv); missing package → error
- [x] Dev server iframe + reload-on-save (`fs-change` → rebuild)
- [x] Production `vite build` → `dist/` + `serveStatic`
- [x] `vite.config.js` read; Vue/Svelte plugins → clear error
- [x] Demo Load Vite + Preview uses in-tab path (not host `npm run dev:vite`)

**Exit (subset):** `demo/templates/vite` bundles in-tab. Not bit-identical to Vite 8.

#### Phase 29 — Vite plugins `M` ✅ (MVP)

- [x] React path = esbuild `jsx: automatic` + react shim
- [x] CSS imports + CSS modules proxy; SVG/PNG as URL strings
- [x] Vue/Svelte: explicit unsupported error
- [x] `resolve.conditions` includes `browser` / `development` in **embed**

---

### Pillar E — Next.js subset (esbuild + kernel VFS; not full `next` CLI)

#### Phase 30 — Next hello `L` ✅ (subset)

- [x] In-tab `nextDev` / `nextBuild` for App Router client pages (`app/page.js`)
- [x] No edge middleware (documented)
- [x] `next/image` + `next/link` shims; CSS modules proxy
- [x] Pin: Next **15.5.x** template; runtime is subset not `next start`
- [x] Extra route `app/hello/page.js` → `/hello`

**Exit (subset):** demo Next preview serves bundled App Router page + `/hello`. Not full SSR/Turbopack.

#### Phase 31 — Next harden `L` ✅ (subset)

- [x] `app/api/*/route.js` → static JSON stub in preview (not full server actions)
- [x] `next/cache` / `next/headers` in **embed**
- [x] Guest `fetch` stub (no raw internet)
- [x] Turbopack = non-goal

**Exit (subset):** demo Next preview serves bundled App Router page + `/hello`. Full SSR is Phase 31.

---

### Pillar F — Developer product (Host UI; kernel unchanged)

UI must not grow a JS Node. Every Run/Install/Terminal action is `bn.spawn` / `bn.fs`.

#### Phase 32 — Terminal chrome `M` ✅ (MVP)

- [x] Multi-tab terminal (two kernel `sh -c` sessions)
- [x] Command palette (Ctrl+K) → same ABI
- [x] CSS fit / xterm-class chrome
- [ ] Optional: `@xterm/xterm` npm addon

#### Phase 33 — Project UX `M` ✅ (MVP)

- [x] Search filenames in VFS, drag-drop ZIP, templates gallery (Vite / Next / Express) — **Host**

#### Phase 34 — Preview UX `S–M` ✅ (MVP)

- [x] Demo status bar lists kernel/host listen ports
- [x] Network log (OUTPUT tab) — **Host** over kernel ports

#### Phase 35 — Sync `L` ✅ (MVP)

- [x] Snapshot export download (kernel tar.gz) + ZIP/tar import
- [ ] Yjs optional; not WC-required

#### Phase 36 — Agent API `M` ✅

- [x] Headless: `NodeBrowser.boot` / `fs` / `spawn` / `install` / `ports` / `killTree`
- [x] JSON-RPC `bn.rpc` / `handleAgentRpc`
- [x] `examples/headless.mjs`

---

### Pillar G — Performance (kernel)

#### Phase 37 — Performance `L` ✅ (MVP) / remainder

- [x] `scripts/bench.mjs` local boot/spawn timings
- [x] npm cache hit/miss metrics (host)
- [x] Lazy-load WASM factory (`import()`)
- [x] Incremental OPFS dirty flush
- [ ] SAB + Atomics stdio in **C++**
- [ ] Benchmarks vs WebContainers (external bake-off)
- [x] `node_modules` / VFS memory cap (`Vfs::set_max_bytes`, default 512 MiB)

#### Phase 38 — Reliability `M` ✅ (MVP)

- [x] Crash recovery: `persist: true` hydrates last OPFS snapshot
- [x] Fuzz C++ VFS paths (`bn_vfs_test`)
- [x] Native `bn_*_test` on every PR
- [ ] CI: Chromium/Firefox/WebKit **with WASM** (Playwright)

---

### Pillar H — Security

#### Phase 39 — Guest policy `M` ✅ (MVP)

- [x] Trust boundary documented: guest JS in WASM is untrusted vs host page
- [x] Egress allowlist: host `fetch` to npm registry HTTPS only
- [x] No guest `eval` into host DOM (guest stays in QuickJS)
- [x] Lifecycle deny-by-default (allowlist in host install)
- [x] CSP guidance for embedders; `SECURITY.md`
- [x] Kernel-enforced guest `fetch` / `http.get` throw (no raw internet)

---

### Pillar I — Productization (Host + docs; kernel stays C++)

#### Phase 40 — Publish & docs `M` ✅ (MVP)

- [x] npm package = WASM artifacts + thin TS
- [x] Release workflow (1.0.x)
- [x] Guides: PLAN / FAQ / ARCHITECTURE (honest subset)
- [x] WC migration: `WebContainer` shim
- [x] TypeDoc script `npm run docs -w @foisal/nodebrowser`

#### Phase 41 — Compat shim `M` ✅

- [x] `WebContainer` class + `@foisal/nodebrowser/compat` — **TS names** wrapping the same kernel
- [x] Document deltas (FAQ / PLAN)

#### Phase 42 — Ecosystem `S–L` ✅ (MVP)

- [x] `examples/headless.mjs`, Express template, custom **C++** `register_command` (see kernel)
- [x] Plugins that add kernel commands, not JS Node polyfills (documented)

---

## Priority order (C++-first)

If capacity is limited:

1. ~~**13b** WASM-only guest~~ ✅ (`js-runtime.ts` deleted; CI WASM boot)
2. **18 harden** HTTP keep-alive only on WASM
3. ~~**16 harden** non-blocking `node` (Worker)~~ ✅ — kill tree + browser Worker; Asyncify/interrupt still later
4. ~~**Real Vite/tsc in QuickJS**~~ ✅ try installed CLI; esbuild-wasm remains the Vite fast path when the graph does not fit
5. **37** install cache + benchmarks vs WebContainers
6. **32** xterm UI
7. **31** Next route handlers subset

Do **not** reintroduce a TypeScript guest Node.

---

## Success metrics

| Metric | Target |
| ------ | ------ |
| Product runtime | **100% guest Node in C++/WASM** |
| JS remaining | Host API + UI + `fetch`/OPFS/SW only |
| Boot to usable VFS | < 3s WASM on mid laptop (JS boot is not a goal) |
| `npm install vite` (cached) | Same order of magnitude as WC |
| Vite React template | Runs **in-tab on WASM** with HMR |
| create-next-app default | Runs **in-tab on WASM** (subset) |
| Refresh | OPFS of kernel VFS survives reload |
| Tests | Native C++ tests + WASM conformance |
| Honesty | MODULES.md = embed coverage, not `js-runtime.ts` |

---

## Non-goals

| Non-goal | Why |
| -------- | --- |
| A second Node in TypeScript | This plan forbids it |
| Native `.node` addons | No arbitrary native code in-browser |
| Perfect Node 22 bit-identical APIs | Subset; document in MODULES.md |
| Full POSIX fork / OS threads | Cooperative processes + WASM workers |
| Raw TCP/UDP to the internet | Virtual ports + host egress |
| Full Turbopack / all Next enterprise | Version-pinned subset |
| Hardened multi-tenant malware sandbox | Different product |
| Replacing the host OS | Tab-scoped WASM kernel |
| Compiling upstream Node+V8+libuv | Multi-year; QuickJS-in-WASM is the engine |

---

## Tracking

- Module checklist (guest embed): [`runtime/node/MODULES.md`](./runtime/node/MODULES.md)
- Public summary: [`ROADMAP.md`](./ROADMAP.md)
- Changelog: [`CHANGELOG.md`](./CHANGELOG.md)
- Architecture: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)

Update this file when a phase starts or finishes. If a task can be done in either C++ or JS, **choose C++**. If it needs a browser API, keep a thin host bridge and put state in the kernel.
