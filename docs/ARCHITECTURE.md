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

- `NodeBrowser.boot` / `mount` / `spawn` / events; `WebContainer` name shim
- Browser bridges: Service Worker HttpBridge, OPFS, **allowlisted** fetch to npm registry
- Load WASM + call C ABI

**There is no guest Node in TypeScript.** `packages/api/src/kernel/` loads `browsernode_kernel.wasm` and calls `bn_*`.

### Host package layout (`packages/api/src`)

| Folder | Owns |
| ------ | ---- |
| `host/` | `NodeBrowser`, types, WebContainer class |
| `kernel/` | WASM loader + Worker proxy |
| `fs/` | VFS tree flatten, OPFS, zip/tar |
| `net/` | HttpBridge, npm egress allowlist |
| `npm/` | install, bin shims, lockfile detect |
| `bundler/` | esbuild-wasm, in-tab Vite/Next subset, ZIP preview |
| `compress/` | gzip/inflate helper |
| `index.ts` / `compat.ts` | public barrels (`dist/index.js`, `dist/compat.js`) |

See **Language law** in [`ROADMAP.md`](../ROADMAP.md).

## Why QuickJS (not full Node C++ port)

Compiling upstream Node + libuv + V8 to WASM is a multi-year port. QuickJS is small, embeddable, and enough to run a large subset of JS tooling when paired with Node API polyfills **inside the WASM image**. We can later swap the engine (or add a second) without changing the host API.

Guest core modules live in `kernel/embed/guest_modules.js`, compiled into the kernel as `generated_guest_modules.hpp`, and evaluated after the QuickJS bootstrap. That is the **only** Node surface. New modules go there + C++ `__bn` bindings, never in the host package.

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
