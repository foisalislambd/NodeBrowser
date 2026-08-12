# NodeBrowser — Master Plan

**North star:** Become the most capable open-source **WebContainers-class** runtime — run real Node tooling (`npm`, Vite, Next subset, tests, monorepos) **entirely in the browser tab**, with no remote compute VM.

**The product is C and C++ compiled to WASM.** Guest Node, VFS, processes, shell, HTTP keep-alive, and core modules live in the **C++ kernel + embedded QuickJS**. TypeScript/JS is **not** a second runtime. It is only the **host API and UI**.

---

## Language law (non-negotiable)

This is the whole system. Do not grow a parallel Node in browser JS.

| Layer | Language | Owns | Forbidden |
| ----- | -------- | ---- | --------- |
| **Kernel** | **C / C++ → WASM** (Emscripten) | VFS, processes, pipes, ports, spawn, shell builtins, C ABI (`bn_*`) | Reimplementing this in TS |
| **Guest Node** | **C++ + QuickJS** (`kernel/embed/guest_modules.js` baked into `generated_guest_modules.hpp`) | `require`, ESM rewrite, `fs`/`http`/`stream`/`crypto`/… as Node sees them | New guest features in `packages/api/src/js-runtime.ts` |
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

**JS fallback (`js-runtime.ts`) — freeze then delete**

- Historical MVP for Pages without WASM / Node CI without a wasm loader.
- **Frozen:** no new guest modules, no new shell, no new fs APIs.
- **Target:** remove as default; CI loads WASM (or skips). Keep a stub that errors clearly: “WASM kernel required”.
- Until deleted, it may lag. Never block C++ work on JS parity.

---

## Architecture (target = current direction)

```
Browser tab
  Demo UI  ──►  @foisal/nodebrowser (TS host)
                    │  bn_* C ABI
                    ▼
              browsernode.wasm
                VFS │ Process table │ Shell builtins
                QuickJS + guest_modules (Node subset)
                    │  server-ready / http dispatch
                    ▼
              Service Worker preview  /  OPFS (host flush)
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
| `boot` / `mount` / `spawn` | ✅ | ✅ host API over C ABI | Phase 41 shim |
| Terminal | xterm | Demo input → kernel `sh -c` | Phase 32 UI only |
| `npm install` | Fast | Host fetch → kernel VFS | C++ untar/lock later if needed |
| `npm run` / `npx` / `.bin` | ✅ | ✅ kernel PATH + host `runScript`/`npx` wrappers | Harden lifecycle in kernel |
| Shell | ✅ | ✅ C++ `cmd_sh` subset | More POSIX in C++ |
| ESM | ✅ | ✅ QuickJS guest rewrite | Harden in embed, not TS |
| `fs.watch` | ✅ | ✅ C++ + host events | — |
| Vite in-tab | ✅ | Templates only | Phases 27–28 **on WASM** |
| Next in-tab | subset | Templates only | Phases 29–30 **on WASM** |
| Keep-alive HTTP | ✅ | ✅ retained QuickJS in WASM | Drop JS HttpBridge-as-server |
| Guest modules | ✅ | **Only** C++ embed | Shrink/delete `js-runtime.ts` |
| Multi-port UX | ✅ | Basic iframe | Phase 34 UI |
| COOP/COEP / SAB | Used | Demo local | Phase 37 kernel stdio |
| Install cache | Optimized | Host memory/Cache API | Kernel-visible cache index |
| API compat | Native | Different names | Phase 41 host-only shim |
| Open source | Partial | ✅ MIT kernel+API | Keep honest docs |

### Must-add backlog (always implement in C++/QuickJS unless marked Host)

#### A. Disk

- [x] OPFS persist — **Host** flush of C++ VFS (Phase 14)
- [x] Symlinks + binary + `fs.watch` — **C++ VFS** (Phase 15)
- [ ] Shareable snapshot links — Host UI on kernel tar (Phase 35)

#### B. Node + npm (kernel)

- [x] ESM / `import` / `node:` — **QuickJS embed** (Phase 20)
- [x] `.bin` PATH, `npm run`, `npx` — kernel spawn + thin host wrappers (Phases 23–24)
- [x] Shell subset — **C++ `cmd_sh`** (Phase 25)
- [x] stdin / tty stubs / `wait` — kernel (Phase 16)
- [ ] Delete JS guest path; WASM is the only `node` (Phase 13 remainder)

#### C. Network (kernel)

- [x] WASM HTTP keep-alive MVP — retained QuickJS (Phase 18)
- [ ] Parity: no JS-only server path (Phase 18 harden)
- [ ] Multi-port preview UI — **Host** (Phase 34)

#### D. Apps in-tab (must boot on WASM)

- [ ] Vite + HMR in-tab (Phases 27–28)
- [ ] Next subset in-tab (Phases 29–30)
- [ ] Express demo after HTTP harden

#### E. DX (Host UI only)

- [ ] xterm.js (Phase 32) — still talks to kernel `spawn`
- [ ] File search / templates gallery (Phase 33)
- [ ] `WebContainer` API shim (Phase 41) — names only, same WASM kernel
- [ ] Docs (Phase 40)

#### F. Open-source win

- [ ] Auditable C++/WASM in CI (no JS-kernel green as “ship”)
- [ ] Benchmarks vs WC (Phase 37)
- [ ] Headless host API for agents (Phase 36)
- [ ] Honest `MODULES.md` (guest = embed, not TS)

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
| 13 WASM default | ✅ | `useWasm: true` default; conformance still has JS leftover — **remove** |

Historical note: some checkboxes were first proven on a JS fallback. That does **not** make JS the product. Re-verify every guest feature on `bn_node_test` + WASM boot.

---

## Future roadmap — C/C++ kernel, host stays thin

Phases ordered by dependency. **Exit criteria = works in C++/WASM**, not in `useWasm: false`.

Estimate bands: S ≤ 1–2 weeks, M ≈ month, L multi-month (small team).

### Pillar 0 — Kill the JS guest (do this while shipping)

#### Phase 13b — WASM-only guest `M`

- [ ] CI: `bn_node_test` / `bn_vfs_test` required; Playwright or node loader boots **WASM**
- [ ] `NodeBrowser.boot()` default remains WASM; `useWasm: false` deprecated
- [ ] `js-runtime.ts`: freeze; then replace with “kernel required” error
- [ ] Conformance suite runs against WASM (or native ABI), not JS kernel
- [ ] Stop documenting JS as a supported Node runtime

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

**Still open:** Phase 13b (delete JS guest).

#### Phase 14 — Persistent VFS `M` ✅

Host OPFS is a **cache of C++ VFS**, not a second filesystem.

- [x] `boot({ persist: true })` hydrate/flush `/home`
- [x] Snapshot tar export/import
- [ ] Optional: kernel-initiated dirty-page flush (fewer host walks)

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
- [x] `sh -c '… &'` / `wait` MVP
- [x] Max procs limit
- [ ] Process groups / kill tree in **C++**
- [ ] Asyncify or worker so long `node` does not block the tab

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
- [ ] Guest `fetch` allowlist implemented in kernel + host hook (not a JS Node `http`)
- [ ] Remove any “server only works on JS kernel” paths

#### Phase 19 — Crypto / zlib `M` ✅ (embed + C++ where hashing lives)

- [x] sha1/256/384/512; zlib sync + streams in guest
- [ ] Optional: move hot hash/zlib to C for speed

#### Phase 20 — ESM + CJS `L` ✅ (embed MVP)

- [x] `import`/`export` rewrite-to-CJS in QuickJS bootstrap
- [x] `import.meta.url`, dynamic `import()`, `exports` field, `node:`
- [ ] Harden package `exports` / ESM in **embed** (not TS)

#### Phase 21 — Workers & VM `L` (C++ / WASM Workers — stubs today)

- [x] Stubs in embed (`worker_threads.Worker` throws; `vm` same-realm)
- [ ] Real `worker_threads`: extra QuickJS runtime or WASM worker + SAB (COOP/COEP)
- [ ] MessagePort for HMR — kernel or host bridge, not a JS Node
- [ ] `vm`: additional QuickJS `JSContext` in C++

#### Phase 22 — Builtins matrix `M` (ongoing, embed)

- [x] `child_process` → kernel spawn; `cluster`/`dns`/`dgram`/`inspector`/`v8`/`wasi` stubs
- [x] `createReadStream` / `createWriteStream` / `opendir` / `rmdir` / `mkdtemp`
- [ ] Fill MODULES.md gaps **in embed** as Vite/Next demand them

**Pillar B exit:** Vite scaffold packages `require()` without missing-module crashes **on WASM**. Stubs OK if documented.

---

### Pillar C — Package manager & shell

**Execute in C++. Host only fetches bytes.**

#### Phase 23 — npm 2.0 `M` ✅ (MVP) / move more into kernel

- [x] Host: lockfile generate, peer warn, optional skip, bin shims, lifecycle allowlist, AbortSignal
- [x] Kernel: `.bin` on `spawn` PATH
- [ ] Lifecycle scripts always `kernel.spawn("sh")` (already) — expand allowlist in policy, not a TS shell
- [ ] Optional: C++ tar/gzip extract (today host `DecompressionStream` + write VFS)
- [ ] Registry mirror / OPFS tarball cache — **Host** storage, kernel reads blobs
- [ ] Scoped / unicode / legacy peer edge cases

#### Phase 24 — npx / runners `M` ✅ (MVP)

- [x] Host `npx` / `runScript` → kernel `spawn`
- [x] Local `.bin/vite` etc. via C++ PATH
- [ ] `npm` / `npx` as **C++ commands** (parse argv in kernel; host only for registry GET)

#### Phase 25 — Shell `M` ✅ (C++ MVP)

- [x] C++ `cmd_sh`: `|`, `&&`, `||`, `;`, redirects, env, `cd`/`export`
- [x] Builtins: `pwd` `echo` `which` `ls` `cat` `mkdir` `rm` `cp` `mv`
- [x] Demo line → `spawn('sh', ['-c', line])`
- [x] More POSIX in **C++**: glob `*`/`?`, `test`/`[` `-f`/`-d`/`-e`
- [ ] xterm UI is Phase 32 (**Host**); PTY semantics stay kernel

#### Phase 26 — Alternate lockfiles `S–M` ✅ (MVP)

- [x] Detect pnpm/yarn lock — warn on `install`; npm still extracts into kernel VFS
- [x] `corepack` stub in **embed** (does not run yarn/pnpm)

---

### Pillar D — Vite in the browser (kernel VFS + esbuild-wasm)

Upstream `vite` CLI is too large for QuickJS. In-tab Vite = C++ `vite` command + host esbuild-wasm + kernel files.

#### Phase 27 — Vite platform APIs `M` ✅ (MVP)

- [x] `fs.watch` (Phase 15, C++)
- [x] HTTP upgrade / WebSocket: guest `ws` stub + HMR **reload** via `__hmr_gen` poll
- [x] `esbuild` in a Worker — host `esbuild-wasm` `{ worker: true }` in browser
- [x] `connect`-style middleware — guest `connect` stub → `http.createServer`

#### Phase 28 — In-tab `vite` / `vite build` `L` ✅ (subset)

- [x] `vite` / `vite build` — C++ command → host `__bn_on_tool` → `viteDev` / `viteBuild`
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

#### Phase 31 — Next harden `L`

- [ ] Route handlers / server actions subset in guest
- [ ] `node:` builtins Next needs — **embed + C++**
- [ ] Cache/fetch stubs
- [ ] Turbopack = non-goal

**Exit (subset):** demo Next preview serves bundled App Router page + `/hello`. Full SSR is Phase 31.

---

### Pillar F — Developer product (Host UI; kernel unchanged)

UI must not grow a JS Node. Every Run/Install/Terminal action is `bn.spawn` / `bn.fs`.

#### Phase 32 — Terminal chrome `M`

- [ ] xterm.js + fit
- [ ] Multi-tab; each tab = kernel process
- [ ] Layout persist
- [ ] Command palette → same ABI

#### Phase 33 — Project UX `M`

- [ ] Multi-root, drag-drop, search, diff, templates gallery — **Host**; files in C++ VFS

#### Phase 34 — Preview UX `S–M`

- [ ] Multi-port UI, network log, HTTPS via SW — **Host** over kernel ports

#### Phase 35 — Sync `L`

- [ ] Snapshot share links — Host + kernel tar
- [ ] Yjs optional; not WC-required

#### Phase 36 — Agent API `M`

- [ ] JSON-RPC over the **same C ABI** (`fs`, `spawn`, `install`, `ports`)
- [ ] Headless: no demo UI; still WASM kernel
- [ ] Editor extension exploration

---

### Pillar G — Performance (kernel)

#### Phase 37 — Performance `L`

- [ ] Benchmarks vs WC: boot WASM, install, vite
- [ ] SAB + Atomics stdio in **C++** when COOP/COEP
- [ ] Incremental OPFS from dirty VFS nodes
- [ ] npm cache metrics (host)
- [ ] Lazy-load WASM
- [ ] `node_modules` memory policy in VFS

#### Phase 38 — Reliability `M`

- [ ] Crash recovery from last kernel snapshot
- [ ] Fuzz C++ VFS paths
- [ ] CI: Chromium/Firefox/WebKit **with WASM**
- [ ] Native `bn_*_test` on every PR

---

### Pillar H — Security

#### Phase 39 — Guest policy `M`

- [ ] Trust boundary: guest JS in WASM is untrusted vs host page
- [ ] Egress allowlist: host `fetch` hooked from kernel
- [ ] No guest `eval` into host DOM
- [ ] Lifecycle deny-by-default (kernel spawn policy)
- [ ] CSP for embedders; `SECURITY.md`

---

### Pillar I — Productization (Host + docs; kernel stays C++)

#### Phase 40 — Publish & docs `M`

- [ ] npm package = WASM artifacts + thin TS
- [x] Release workflow (1.0.x)
- [ ] TypeDoc for **host** API only
- [ ] Guides: boot WASM, VFS, npm, Vite
- [ ] WC migration table (host method names)

#### Phase 41 — Compat shim `M`

- [ ] `@foisal/nodebrowser-compat` — **TS names** wrapping the same WASM kernel
- [ ] Document deltas

#### Phase 42 — Ecosystem `S–L`

- [ ] Examples, custom **C++** builtins, teaching kits
- [ ] Plugins that add kernel commands, not JS Node polyfills

---

## Priority order (C++-first)

If capacity is limited:

1. **13b** WASM-only guest; freeze/delete `js-runtime.ts`
2. **18 harden** HTTP keep-alive only on WASM
3. **16 harden** process groups / non-blocking `node` in C++
4. **20/22** ESM + builtins **in embed** as Vite needs
5. **23–25** npm/shell remaining work in **kernel** (C++ `npm` argv, more sh)
6. **27–28** Vite in-tab on WASM
7. **30** Next subset on WASM
8. **32–34** Host terminal/preview
9. **41 + 40** compat shim + docs
10. **37** benchmarks vs WebContainers (WASM)

Do **not** spend a milestone “catching up JS fallback.”

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
