# Architecture — NodeBrowser

```
┌─────────────────────────────────────────────────────────────┐
│  Browser Tab (COOP + COEP → SharedArrayBuffer)              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Demo UI      │  │ @foisal/     │  │ Service Worker    │  │
│  │ Editor/Term  │◄─┤ nodebrowser  │◄─┤ Preview + proxy   │  │
│  └──────────────┘  └──────┬───────┘  └─────────┬─────────┘  │
│                           │ MessagePort / SAB               │
│                    ┌──────▼────────────────────┐            │
│                    │  browsernode_kernel.wasm  │            │
│                    │  ┌────────┐ ┌───────────┐ │            │
│                    │  │  VFS   │ │ Processes │ │            │
│                    │  └────────┘ └───────────┘ │            │
│                    │  ┌────────────────────────┐│            │
│                    │  │ QuickJS + Node bootstrap││            │
│                    │  └────────────────────────┘│            │
│                    └────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## Kernel responsibilities (C++)

- Own all file bytes (RAM VFS; optional OPFS sync later)
- Process IDs, parent/child trees, argv, env, cwd, exit codes (`kill` = kill tree)
- stdio ring buffers shared with host
- Virtual listen ports → host `server-ready` events
- Export a stable C ABI for the TS host (`bn_*` functions)
- Own guest Node surface over time (bootstrap + core modules) — **not** the TS host

## Host API responsibilities (TypeScript only)

- `NodeBrowser.boot` / `mount` / `spawn` / events
- `WebContainer` compatibility layer (`host/webcontainer.ts`) — public tutorial surface, workdir-relative paths, process streams
- Browser bridges: Service Worker HttpBridge, OPFS, **allowlisted** fetch to npm registry
- Load WASM + call C ABI

**There is no second guest Node written as the product runtime.** `packages/api/src/kernel/` loads `browsernode_kernel.wasm` and calls `bn_*`. An optional host engine can run the same guest bootstrap on V8; the kernel still owns the files.

### Host package layout (`packages/api/src`)

| Folder | Owns |
| ------ | ---- |
| `host/` | `NodeBrowser`, types, WebContainer compatibility layer, auth names |
| `kernel/` | WASM loader, Worker proxy, `HostGuestEngine` |
| `fs/` | VFS tree flatten, OPFS, zip/tar |
| `net/` | HttpBridge, npm egress allowlist |
| `npm/` | install, bin shims, lockfile detect |
| `bundler/` | esbuild-wasm, in-tab Vite/Next subset, ZIP preview |
| `compress/` | gzip/inflate helper |
| `index.ts` / `compat.ts` | public barrels (`dist/index.js`, `dist/compat.js`) |

See **Language law** in [`ROADMAP.md`](../ROADMAP.md). Guides: [`docs/README.md`](./README.md) · [API](./API.md) · [User](./GUIDE.md).

## Why QuickJS (not full Node C++ port)

Compiling upstream Node + libuv + V8 to WASM is a multi-year port. QuickJS is small, embeddable, and enough to run a large subset of JS tooling when paired with Node API polyfills **inside the WASM image**.

Guest core modules live in `kernel/embed/guest_modules.js`, compiled into the kernel as `generated_guest_modules.hpp`, and evaluated after the QuickJS bootstrap. New Node modules go there + C++ `__bn` bindings, never in the host package.

### Guest engines

`spawn` always asks the kernel to create the process, except when `boot({ guestEngine: 'v8' })` accepts the command. That path is `HostGuestEngine` in `packages/api/src/kernel/guest-engine.ts`:

| Engine | Where the program runs | When |
| ------ | ---------------------- | ---- |
| `quickjs` (default) | Inside the WASM kernel | Every `node` / `sh` the kernel understands |
| `v8` | Host JS engine, same guest bootstrap | `guestEngine: 'v8'` and the kernel calls are synchronous |

The interface is `tryRun(program) => result \| null`. `null` means “keep the kernel process.” A later build can implement the same interface in a Worker so guest code runs on the browser’s JS engine off the boot thread. The filesystem API does not change.

### Process lifetime

Host stdio is a poll (or a SharedArrayBuffer ring when the page is cross-origin isolated and `coep` is not `none`). Each process is registered on the instance. `teardown()`:

1. Stops poll timers and closes output streams (`exit` resolves with `137` if the process was still running).
2. Closes virtual ports and emits `port` / `close`.
3. Drops listeners and the global spawn hooks owned by this instance.
4. Destroys the kernel on a microtask, after those host callbacks return.

`WebContainer.boot({ coep: 'none' })` forces the poll transport so a page without COOP/COEP still runs. See [MIGRATING.md](./MIGRATING.md).

## Process model

Processes are **cooperative**, not OS threads:

1. Host calls `bn_spawn(cmd, argv)`
2. Kernel creates a `Process` with pipes
3. For `node`, kernel runs QuickJS on that process context
4. Blocking I/O yields to the browser via Asyncify or host promises
5. Exit code reported to host

## Filesystem semantics

- Paths are POSIX absolute (`/home/project/...`)
- Symlinks supported as VFS nodes
- `node_modules` is just directories — no special magic beyond resolver

## Networking

Node `net.Server` / `http.Server` register a port in the kernel.
Host maps `https://<origin>/__bn_preview/<port>/...` via Service Worker
into an in-memory request that invokes the JS HTTP callback.
