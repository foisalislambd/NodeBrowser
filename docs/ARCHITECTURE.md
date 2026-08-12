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
│                    │  browsernode.wasm (kernel)│            │
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
- Process IDs, argv, env, cwd, exit codes
- stdio ring buffers shared with host
- Virtual listen ports → host `server-ready` events
- Export a stable C ABI for the TS host (`bn_*` functions)
- Own guest Node surface over time (bootstrap + core modules) — **not** the TS host

## Host API responsibilities (TypeScript only)

- `NodeBrowser.boot` / `mount` / `spawn` / events
- Browser bridges: Service Worker HttpBridge, OPFS, fetch to npm registry
- Load WASM + call C ABI — **no parallel guest Node implementation as the product path**

See **Architecture rule** in `[PLAN.md](../PLAN.md)`.

## Why QuickJS (not full Node C++ port)

Compiling upstream Node + libuv + V8 to WASM is a multi-year port. QuickJS is small, embeddable, and enough to run a large subset of JS tooling when paired with Node API polyfills **inside the WASM image**. We can later swap the engine (or add a second) without changing the host API.

Guest core modules live in `kernel/embed/guest_modules.js`, compiled into the kernel as `generated_guest_modules.hpp`, and evaluated after the QuickJS bootstrap. That is the product Node surface — not `packages/api/src/js-runtime.ts` (emergency fallback only).

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
Host maps `https://<origin>/__bn/<id>/<port>/...` via Service Worker
into an in-memory request that invokes the JS HTTP callback.
