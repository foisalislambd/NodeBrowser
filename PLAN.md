# NodeBrowser — Master Plan

**North star:** Become the most capable open-source **WebContainers-class** runtime — run real Node tooling (`npm`, Vite, Next subset, tests, monorepos) **entirely in the browser tab**, with no remote compute VM.

**Strategy:** **C++/C → WASM is the product.** The TypeScript/`packages/api` layer is only the **host API** (boot, mount, spawn, events, browser bridges). Guest Node behavior must live in the **C++ kernel + QuickJS bootstrap**, not in a parallel JS runtime. Prefer *working vertical slices* in WASM over fake “100% Node” claims.

---

## Architecture rule (non-negotiable going forward)

| Layer | Language | Allowed to do | Must NOT become |
|-------|----------|---------------|-----------------|
| **Kernel / guest Node** | **C++ / C → WASM** (+ QuickJS embed) | VFS, processes, pipes, ports, `node` bootstrap, core modules (`fs`, `http`, `stream`, …), keep-alive HTTP | A second “full Node” written in browser JS |
| **Host API** | **TypeScript / JS** (`@foisal/nodebrowser`) | `boot` / `mount` / `spawn`, event bus, HttpBridge ↔ SW, OPFS/IndexedDB, npm registry fetch, esbuild-wasm glue | Re-implementing the kernel or guest module surface |
| **Demo / UI** | JS | Editor, terminal, preview chrome | Runtime semantics |

**Why this rule exists**

- WebContainers-class depth (real `npm`, Vite HMR, process trees, binary VFS) needs **one** authoritative runtime. Dual JS+C++ feature work doubles cost and stalls advances.
- Browser JS fallback (`js-runtime.ts`) was an MVP accelerator for demos/CI without WASM. It is **not** the long-term product path.
- Going forward: **new Node/compat work lands in C++/QuickJS first**; host TS only wires ABI + browser APIs. JS fallback may lag or stay intentionally thinner until removed/shrunk.

**Policy for existing JS fallback**

- Keep it only as **emergency / no-WASM fallback** (Pages without COOP/COEP, Node CI without wasm loader).
- Do **not** add new guest features only in `js-runtime.ts` unless the same slice is scheduled for C++ in the same milestone.
- Prefer deleting or freezing JS-only guest modules once WASM parity exists.

---

## Architecture (current)


| Layer       | Technology                             | Role                                 |
| ----------- | -------------------------------------- | ------------------------------------ |
| Kernel      | C++ → WASM (Emscripten) — **primary**  | VFS, processes, pipes, virtual ports |
| JS Engine   | QuickJS (in WASM) + thin JS fallback   | Execute JS/CJS like `node`           |
| Node Compat | **C++/QuickJS bootstrap** (target)     | `fs`, `path`, `http`, `crypto`, …    |
| Package Mgr | TS host + npm registry                 | install into VFS (+ deps + cache)    |
| Networking  | Service Worker ↔ HttpBridge (+ WASM dispatch) | Preview `/__bn_preview/:port` |
| Host API    | `@foisal/nodebrowser` (`packages/api`) | WebContainer-like DX **only**        |
| Demo        | Vanilla UI                             | File manager, terminal, preview      |


Details: `[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)` · Module matrix: `[runtime/node/MODULES.md](./runtime/node/MODULES.md)`

---

## WebContainers parity — what they have vs what we must add

StackBlitz **WebContainers** = WASM micro-OS + Node-in-tab + VFS + virtual network (Service Worker) + polished DX.  
**NodeBrowser** already shares the same *shape* (C++→WASM kernel, VFS, spawn, SW preview, npm-into-VFS). Below is the honest gap list — **add these to become WC-class**.

### Side-by-side


| Capability | WebContainers (typical) | NodeBrowser now | Add via |
| ---------- | ----------------------- | --------------- | ------- |
| WASM runtime / kernel | Mature micro-OS | C++→WASM kernel ✅ (early) | Harden kernel (phases 13 remainder, 16–18) |
| In-memory VFS | ✅ | ✅ | — |
| Persist across refresh | Strong (browser storage) | ✅ OPFS `boot({ persist })` | — |
| `boot` / `mount` / `spawn` API | ✅ public API | ✅ `@foisal/nodebrowser` | Phase **41** compat shim |
| Full terminal (xterm) | ✅ | Basic demo term | **Phase 32** |
| `npm install` (real trees) | Fast, production | Works, limited | **Phases 23–24** |
| `npm run` / `npx` / `.bin` | ✅ | Partial / missing | **Phases 23–24** |
| Shell (`sh`, pipes, redirects) | ✅ enough for tooling | Minimal | **Phase 25** |
| Node ESM (`import`) | ✅ | ✅ rewrite-to-CJS MVP | Harden Phase 20 |
| Watch / HMR FS events | ✅ | ✅ `fs.watch` + `fs-change` | — |
| Vite **in-tab** (dev + HMR) | ✅ | Host templates only | **Phases 27–28** |
| Next.js **in-tab** (subset) | ✅ (common apps) | Host templates only | **Phases 29–30** |
| Keep-alive HTTP servers | ✅ | **C++/QuickJS retain MVP** + JS fallback | Harden Phase 18 |
| Guest Node modules (stream/zlib/ESM/…) | ✅ | **Primary: C++ embed `guest_modules.js`** | Shrink JS fallback |
| Multi-port preview UX | ✅ | Basic iframe | **Phase 34** |
| COOP/COEP / SAB fast-path | Used where needed | Demo local only; Pages limited | **Phase 37** + Pages headers strategy |
| Package install speed / cache | Highly optimized | Memory cache only | **Phases 23, 37** |
| WebContainer API compat | Native | Different names | **Phase 41** `@foisal/nodebrowser-compat` |
| Open source | API docs; runtime proprietary | ✅ MIT kernel+API | Keep honest docs |

### Must-add backlog (WC-like product)

Ordered for **maximum WC feel per week** — map to numbered phases already in this file:

#### A. Feel like a real project disk
- [ ] **OPFS persistence** (survive reload) → Phase **14**
- [ ] Symlinks + binary polish + `fs.watch` → Phase **15**
- [ ] Snapshot export/import (shareable project) → Phase **35**

#### B. Feel like real Node + npm
- [ ] ESM / `import` / `node:` fully → Phase **20**
- [ ] `node_modules/.bin`, `npm run`, `npx` → Phases **23–24**
- [ ] Shell subset for scripts → Phase **25**
- [ ] Process groups / kill tree / better stdio → Phase **16**

#### C. Feel like WebContainers networking
- [ ] WASM HTTP keep-alive parity with JS HttpBridge → Phase **18**
- [ ] Multi-port preview + network log → Phase **34**
- [ ] Offline-friendly SW routing (already partial) → harden in **18/34**

#### D. Run the apps WC users expect in-tab
- [ ] Vite React template **in-tab** + HMR → Phases **27–28**
- [ ] Next default app **in-tab** (subset) → Phases **29–30**
- [ ] Express / simple API server demos → after **18**

#### E. Feel like StackBlitz DX
- [ ] xterm.js terminal + tabs → Phase **32**
- [ ] File search, drag-drop, templates gallery → Phase **33**
- [ ] `WebContainer`-shaped API shim → Phase **41**
- [ ] Docs site + migration table → Phase **40**

#### F. Beat them where open-source can win
- [ ] Public C++/WASM kernel anyone can audit → keep shipping from CI
- [ ] Benchmark suite vs WC (boot, install, vite) → Phase **37**
- [ ] Agent/headless API for AI tools → Phase **36**
- [ ] Honest MODULES.md gaps forever → non-negotiable

### Explicit “not copying WC”
Do **not** block on: proprietary WC internals, bit-identical Node, native `.node` addons, full Turbopack, multi-tenant hardened cloud sandbox (see Non-goals).

---



## Completed phases (0–13)


| Phase              | Status | Deliverable                                                                |
| ------------------ | ------ | -------------------------------------------------------------------------- |
| 0 Toolchain        | ✅      | Emscripten, CMake, demo COOP/COEP                                          |
| 1 WASM kernel      | ✅      | VFS + process + C ABI                                                      |
| 2 QuickJS          | ✅      | `node` runner + CJS require                                                |
| 3 Node subset      | ✅      | fs/path/http/events + fs.promises / Buffer                                 |
| 4 Host API         | ✅      | `NodeBrowser.boot/mount/spawn`                                             |
| 5 Virtual net      | ✅      | SW → handler → Response                                                    |
| 6 npm install      | ✅      | deps tree, scoped pkgs, memory cache                                       |
| 7 Async process    | ✅      | keep-alive servers + non-blocking spawn                                    |
| 8 Vite path        | ✅      | esbuild-wasm transform demo                                                |
| 9 Vite Node APIs   | ✅      | crypto / nextTick / perf_hooks                                             |
| 10 Next.js APIs    | ✅      | createRequire / async_hooks stubs / broader fs                             |
| 11 Vite/Next demos | ✅      | Real templates under `demo/templates/`                                     |
| 12 File manager DX | ✅      | VFS explorer + install/run/save in-tab                                     |
| 13 WASM/JS parity  | ✅      | rename, binary buffer I/O, spawn env, `useWasm: 'auto'`, conformance tests |


---



## Future roadmap — make it powerful

Phases below are ordered by **dependency** (foundation → tooling → apps → product). Each phase has a clear exit criteria. Estimate bands are rough (S ≤ 1–2 weeks, M ≈ month, L multi-month for a small team).

### Pillar A — Runtime foundation (must be rock-solid)



#### Phase 13 — WASM ↔ JS parity (default boot) `M` ✅

Make WASM and JS kernels share one host surface; prefer auto-detect with JS fallback.

- [x] Host `bn.fs`: `exists` / `stat` / recursive `rm` / `rename` (kernel or portable copy+rm)
- [x] Binary files: JS VFS stores `Uint8Array`; `readFile(path, 'buffer')` → `Uint8Array`; `writeFile` accepts bytes
- [x] `process.env` injected from `spawn(..., { env })` on **JS** and **WASM** (`bn_spawn` env_json + node_runner inject)
- [x] `NodeBrowser.boot({ useWasm: 'auto' | true | false })` — default `true` (C++/WASM primary; JS fallback)
- [x] `bn.runtime` exposes `'js' | 'wasm'`
- [x] Conformance suite: `packages/api/test/conformance.mjs` via `npm run test:api`
- [x] `bn_vfs_read_bytes` ABI + TS `readBytes`
- [ ] Full HTTP keep-alive feature-parity on WASM (see Phase 18)

**Exit (met for JS path):** conformance script green; same host FS/spawn-env APIs available; auto boot works.

#### Phase 14 — Persistent VFS (OPFS) `M` ✅

Survive refresh like a real project disk.

- [x] Mount root (or `/home`) backed by Origin Private File System (`boot({ persist: true })`)
- [x] Snapshot / export / import project as gzipped tar (`exportSnapshot` / `importSnapshot`)
- [x] “Clear workspace” + export in demo
- [ ] Optional IndexedDB metadata index for fast `readdir` (skipped MVP)
- [x] Migration from pure RAM → OPFS without breaking mount API

**Exit:** refresh tab → `/home/project` still there when `persist: true`.

#### Phase 15 — Binary + symlink + watch `M` ✅

Tooling needs real files, not only UTF-8 strings.

- [x] First-class binary blobs in VFS (images, wasm, fonts) — mount/npm bytes end-to-end
- [x] Symlink create/read/follow (**C++ VFS** `bn_vfs_symlink`/`readlink`/`lstat` + guest `fs.symlinkSync` / `readlinkSync` / `lstatSync`; JS fallback mirrors)
- [x] `fs.watch` / `fs.watchFile` → host `fs-change` event bus
- [ ] `utimes` / mode bits enough for npm package scripts expectations

**Exit:** editor save triggers `fs.watch` / host `fs-change`.

#### Phase 16 — Process model 2.0 `L` ✅ (JS MVP)

Closer to WebContainers process semantics.

- [x] `child_process.spawn` / `execFile` → kernel spawn (node, sh stubs)
- [x] Concurrent processes with isolated cwd/env; shared VFS
- [ ] stdin write + TTY-ish raw mode stubs (`tty`, `readline`)
- [x] Exit / signal semantics (`SIGKILL` via `kill` → 137)
- [ ] Background jobs + `wait` from shell
- [x] Resource limits (max procs 32)

**Exit:** parent `node` spawns child `node`; HTTP keep-alive still `-1` from `wait`.

---



### Pillar B — Node compatibility (unblock real packages)



#### Phase 17 — Streams & Buffer completeness `M` ✅

- [x] Readable/Writable/Transform/Duplex usable with `pipe`
- [x] `buffer` common API; encoding edge cases as needed
- [x] `util.promisify` / `callbackify`
- [x] `string_decoder`, `timers/promises`



#### Phase 18 — Network stack (virtual) `L` ✅ (MVP)

- [x] `net.Server` / `net.Socket` over virtual ports
- [x] `http` completeness: headers, chunked write/end, upgrade stub
- [x] `https` stubs that reuse HTTP bridge
- [x] `http2` — out of scope; non-goal until needed
- [x] Fetch from guest → host allowlist (npm registry + same-origin)
- [x] WASM `bn_http_dispatch` + retained QuickJS keep-alive handlers



#### Phase 19 — Crypto / zlib / compress `M` ✅

- [x] `crypto`: sha1/sha256 (+ sha384/sha512 via host digestSync); cipher stubs clear errors
- [x] `zlib` gzip/gunzip/deflate/inflate sync + stream wrappers
- [x] Guest `zlib` round-trip



#### Phase 20 — Module system: ESM + CJS dual `L` ✅ (JS MVP)

Critical for modern Vite/Next.

- [x] `import` / `export` in `.mjs` and `"type":"module"` packages (rewrite-to-CJS)
- [x] `import.meta.url`
- [x] Dynamic `import()`
- [x] Conditional exports (`exports` field) resolution
- [x] Interop with existing CJS `require`
- [x] `node:` prefix for new modules



#### Phase 21 — Workers & VM `L`

- [ ] `worker_threads` mapped to Web Workers + SharedArrayBuffer when COOP/COEP
- [ ] MessagePort bridging for HMR / esbuild services
- [ ] `vm` / realms (QuickJS contexts) for Jest-like runners
- [ ] Document when SAB unavailable (fallback single-threaded)



#### Phase 22 — Remaining builtins matrix `M` (ongoing)

Track in `MODULES.md`; prioritize by package install telemetry:

- [ ] `child_process`, `cluster` (stub/error clearly)
- [ ] `dns`, `dgram` (virtual or stub)
- [ ] `fs` remaining: `createReadStream`, `createWriteStream`, `opendir`, `rmdir`, `mkdtemp`
- [ ] `inspector` / `v8` — stub
- [ ] `wasi` — evaluate later

**Exit for Pillar B:** top 50 npm packages used by Vite scaffold install + run without missing-module crashes (stubs allowed if documented).

---



### Pillar C — Package manager & shell (WebContainers DX)



#### Phase 23 — npm 2.0 `M`

- [ ] `package-lock.json` respect + generate
- [ ] Peer deps warnings; optional deps
- [ ] `bin` linking into `.bin` + run via spawn path
- [ ] Lifecycle scripts (`preinstall`/`postinstall`) with allowlist / sandbox policy
- [ ] Progress events already exist — add cancellation
- [ ] Registry mirror / offline OPFS tarball cache
- [ ] Scoped + unicode + legacy peer deps edge cases



#### Phase 24 — npx / package runners `M`

- [ ] `npx <pkg>` / `npm exec`
- [ ] Run local `.bin/vite`, `.bin/tsc`, `.bin/next`
- [ ] `npm run <script>` reading `package.json` scripts



#### Phase 25 — Shell subset `M`

- [ ] Minimal `sh`/`bash`-like: pipes `|`, `&&`, env assignment, redirects
- [ ] Builtins: `cd`, `pwd`, `echo`, `export`, `which`, `ls`, `cat`, `mkdir`, `rm`, `cp`, `mv`
- [ ] Demo terminal accepts commands (not only button-driven)
- [ ] Optional **xterm.js** UI



#### Phase 26 — Alternate clients `S–M`

- [ ] Detect/respect `pnpm-lock.yaml` / `yarn.lock` install algorithms (or clear error + npm convert)
- [ ] `corepack` stub — document only unless needed

---



### Pillar D — Vite in the browser (killer feature)



#### Phase 27 — Vite-capable platform APIs `M`

Everything Vite’s Node side needs from Pillars A–C, plus:

- [ ] File watch events (Phase 15)
- [ ] HTTP upgrade / WebSocket **emulation** via MessageChannel + SW (HMR)
- [ ] `esbuild` service running in Worker
- [ ] `connect`-style middleware bridge to HttpBridge



#### Phase 28 — In-tab `vite` / `vite build` `L`

- [ ] Install `vite` + plugin-react into VFS and run via `node node_modules/vite/bin/vite.js`
- [ ] Dev server preview in iframe with HMR
- [ ] Production `vite build` → `/dist` served by `serveStatic`
- [ ] Config: `vite.config.js` load (CJS+ESM)
- [ ] Honest fallback: if unsupported plugin, clear error

**Exit:** official `demo/templates/vite` runs **inside NodeBrowser** (not host `npm run dev:vite`).

#### Phase 29 — Vite ecosystem plugins `M`

- [ ] `@vitejs/plugin-react` / `vue` / `svelte` smoke
- [ ] CSS / PostCSS / Tailwind path (where pure-JS)
- [ ] Path aliases + `resolve.conditions`

---



### Pillar E — Next.js subset (ambitious, staged)



#### Phase 30 — Next “hello” path `L`

Not full Next — a **supported subset**:

- [ ] `next dev` / `next build` / `next start` for App Router **static + simple SSR** pages
- [ ] No middleware edge unless polyfilled
- [ ] Image optimizer stub / passthrough
- [ ] Font loader stub or predownload
- [ ] Document supported Next version pin



#### Phase 31 — Next hardening `L`

- [ ] Route handlers / server actions (subset)
- [ ] `node:` builtins used by Next server
- [ ] Cache / fetch memoization stubs
- [ ] Turbopack — **non-goal** initially (webpack/turbopack native); stay on Next’s JS paths + our bundler bridges

**Exit:** `demo/templates/next` boots in-tab for the default create-next-app page + one dynamic route.

---



### Pillar F — Developer product (feel “most powerful”)



#### Phase 32 — Terminal + IDE shell `M`

- [ ] xterm.js + fit addon
- [ ] Multi-tab terminals
- [ ] Split panes remember layout
- [ ] Command palette (Run / Install / Preview / Export)



#### Phase 33 — Project UX `M`

- [ ] Multi-root workspaces (`/home/a`, `/home/b`)
- [ ] Drag-drop files/folders into VFS
- [ ] Search in files (ripgrep-wasm or JS scan)
- [ ] Diff view for unsaved buffers
- [ ] Templates gallery (Vite, Next, Express, Nest subset, Astro later)



#### Phase 34 — Preview & networking UX `S–M`

- [ ] Multiple ports UI; open-in-new-tab
- [ ] Network log (requests through HttpBridge)
- [ ] HTTPS preview via SW (same-origin)



#### Phase 35 — Collaboration / sync (optional power) `L`

- [ ] Share workspace snapshot link (exported archive + URL)
- [ ] Yjs/CRDT sync — only if product needs; not required for WebContainers parity
- [ ] Read-only public preview boot from static snapshot



#### Phase 36 — Agent / automation API `M`

Make NodeBrowser the best runtime for AI coding agents in-browser:

- [ ] Stable JSON-RPC or evented API: `fs`, `spawn`, `install`, `ports`
- [ ] Structured logs / traces for agent tools
- [ ] Headless mode (no demo UI) for embedding
- [ ] Cursor/VS Code Web extension exploration

---



### Pillar G — Performance & scale



#### Phase 37 — Performance program `L` (ongoing)

- [ ] Benchmark suite vs StackBlitz WebContainers (boot, npm install ms/vite, cold SSR)
- [ ] SAB + Atomics fast-path for stdio when available
- [ ] Incremental OPFS writes; batch mkdir
- [ ] npm metadata/tarball cache hit-rate metrics
- [ ] Lazy-load WASM / code-split demo
- [ ] Memory pressure: GC tips, large `node_modules` eviction policy



#### Phase 38 — Reliability `M`

- [ ] Crash recovery (reload last snapshot)
- [ ] Deterministic test fixtures
- [ ] Fuzz VFS paths / npm pack listings
- [ ] CI matrix: Chromium, Firefox, WebKit (Playwright)

---



### Pillar H — Security model (power without naïveté)



#### Phase 39 — Guest security policy `M`

- [ ] Document trust boundary (guest JS is untrusted w.r.t. host page)
- [ ] Allowlist for egress fetch (npm registry, configured CDNs)
- [ ] Block `eval` to host DOM; iframe sandbox review
- [ ] Lifecycle script policy (deny by default / prompt)
- [ ] CSP guidance for embedders
- [ ] Security audit checklist in `SECURITY.md`

---



### Pillar I — Open-source productization



#### Phase 40 — Publish & docs site `M`

- [ ] Publish `@foisal/nodebrowser` to npm with semver (automated Trusted Publisher on `main`)
- [x] Release workflow: npm OIDC + GitHub Packages + GitHub Release (`1.0.0`…`1.0.9`→`1.1.0`)
- [ ] API reference (TypeDoc)
- [ ] Guide site: Boot, VFS, npm, Vite, embed
- [ ] Migration guide from WebContainers API (method mapping table)



#### Phase 41 — Compatibility layer `M`

- [ ] Optional `@foisal/nodebrowser-compat` shim mirroring StackBlitz WebContainer API shapes where possible
- [ ] Document deltas honestly



#### Phase 42 — Ecosystem `S–L`

- [ ] Example apps repo
- [ ] Community plugins (custom builtins)
- [ ] Browser extension “scratch Node”
- [ ] Teaching kits (learn Node without local install)

---



## Priority order (what to do next)

If capacity is limited, execute for **WebContainers-class power** (see parity section above):

1. **14** OPFS persistence *(WC: project survives refresh)*
2. **18** WASM HTTP keep-alive parity *(WC: real servers in-tab)*
3. **15** watch + symlinks / binary polish *(WC: HMR foundation)*
4. **20** ESM
5. **23–24** npm bin + `npm run` / npx
6. **25** shell subset + **16** process 2.0 as needed
7. **27–28** Vite in-tab
8. **30** Next subset
9. **32–34** terminal / preview UX
10. **41** WebContainer API compat shim + **40** docs
11. **37** benchmarks vs WebContainers

---



## Success metrics (“most powerful”)


| Metric                       | Target                                            |
| ---------------------------- | ------------------------------------------------- |
| Boot to usable VFS           | < 1s JS / < 3s WASM on mid laptop                 |
| `npm install vite` (cached)  | competitive with WebContainers order-of-magnitude |
| Official Vite React template | **runs in-tab** with HMR                          |
| create-next-app default page | **runs in-tab** (subset)                          |
| Refresh durability           | OPFS project survives reload                      |
| API stability                | semver + WebContainer-compat shim                 |
| Honesty                      | MODULES.md + PLAN non-goals always accurate       |


---



## Non-goals (explicit — forever or very long-term)

These are **not** required for “most powerful WebContainers-class” and should not block the roadmap:


| Non-goal                                                          | Why                                     |
| ----------------------------------------------------------------- | --------------------------------------- |
| Native `.node` addons                                             | No arbitrary native code in-browser     |
| Perfect Node 22 bit-identical APIs                                | Track subset; document gaps             |
| Full POSIX fork/true threads                                      | Cooperative processes + Workers instead |
| Raw TCP/UDP to the internet                                       | Virtual ports + controlled egress only  |
| Full Turbopack / all Next enterprise features                     | Version-pinned subset                   |
| Running arbitrary malware safely as a hardened multi-tenant cloud | Different product; we document limits   |
| Replacing the host OS                                             | Tab-scoped runtime only                 |


---



## Tracking

- Module checklist: `[runtime/node/MODULES.md](./runtime/node/MODULES.md)`
- Short public summary: `[ROADMAP.md](./ROADMAP.md)`
- Changelog: `[CHANGELOG.md](./CHANGELOG.md)`
- Architecture: `[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)`

Update this file when a phase starts/finishes — status table at the top of “Future roadmap” can gain ✅ rows over time.