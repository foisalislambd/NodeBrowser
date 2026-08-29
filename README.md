# NodeBrowser

**Run Node-like JavaScript in the browser tab — filesystem, `require`, npm, HTTP preview, and a VS Code–style workbench.**

No remote compute box. The “server” is a **C++ kernel compiled to WebAssembly** in the same tab as the UI.

[![CI](https://github.com/foisalislambd/NodeBrowser/actions/workflows/ci.yml/badge.svg)](https://github.com/foisalislambd/NodeBrowser/actions/workflows/ci.yml)
[![Release](https://github.com/foisalislambd/NodeBrowser/actions/workflows/release.yml/badge.svg)](https://github.com/foisalislambd/NodeBrowser/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@foisal/nodebrowser.svg)](https://www.npmjs.com/package/@foisal/nodebrowser)
[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](./package.json)

**Try it:** [live demo on GitHub Pages](https://foisalislambd.github.io/NodeBrowser/) · **Use it:** [`npm i @foisal/nodebrowser`](https://www.npmjs.com/package/@foisal/nodebrowser)

```ts
import { NodeBrowser } from '@foisal/nodebrowser';

const bn = await NodeBrowser.boot();
await bn.mount({
  home: {
    directory: {
      project: {
        directory: {
          'index.js': { file: { contents: "console.log('hi from NodeBrowser')" } },
        },
      },
    },
  },
});
const proc = await bn.spawn('node', ['/home/project/index.js'], { cwd: '/home/project' });
for await (const chunk of proc.output) console.log(chunk);
```

| Section | What it covers |
|---------|----------------|
| [Docs](./docs/README.md) | User guide, **API**, demo, npm, Tailwind, limits |
| [What is this](#what-is-this-in-plain-words) | Product in one page |
| [What works](#what-works-today) | Honest capability table |
| [Run from source](#run-the-demo-from-source) | Clone, WASM, native tests |
| [How the pieces fit](#how-the-pieces-fit) | Kernel vs host vs demo |

---

## What is this, in plain words?

Imagine StackBlitz / WebContainers: you open a page, there is a terminal, you type `node index.js` or `npm install`, and it works **without SSH-ing to a Linux VM**.

NodeBrowser is that idea as **open source**:

1. You load a WASM module (the kernel).
2. The kernel owns a **virtual disk** (`/home/project/...`) and **virtual processes**.
3. Guest JavaScript runs in **QuickJS inside that WASM**, with Node-ish `fs`, `http`, `require`, …
4. The TypeScript package (`@foisal/nodebrowser`) is only the **host**: load WASM, fetch npm tarballs, talk to a Service Worker for preview iframes.

Your laptop’s real `node_modules` and real Node are **not** the guest runtime (unless you clone this repo and run Vite on the host to serve the demo page).

---

## Why does it exist?

Shipping **full Node + V8 + libuv** to WebAssembly is a multi-year port. Proprietary products already do a polished “Node in the tab,” but you cannot audit or fork them.

NodeBrowser takes a different bet:

- **One kernel in C/C++**, not a fake Node written twice (once in JS, once in WASM).
- **QuickJS** as the guest engine — small enough to embed, good enough for a growing Node subset.
- **Honest docs** about what works today vs what is still a subset (Vite/Next, speed vs V8, native addons).
- **Agent-friendly API** (`boot` / `fs` / `spawn` / `install` / `rpc`) so tools can drive the runtime without the demo UI.

If you want an auditable playground, in-tab ZIP → preview, or a sandbox for coding agents, this is the project.

What we are **not** trying to be on day one: bit-identical Node, native `.node` addons, a hardened multi-tenant malware jail, or a clone of WebContainers’ internals.

---

## Documentation

Step-by-step and API live under **[`docs/`](./docs/README.md)** — not only this README:

| Doc | Contents |
|-----|----------|
| [User guide](./docs/GUIDE.md) | VFS, language law, terminal, persist |
| [API reference](./docs/API.md) | Every `@foisal/nodebrowser` method, events, RPC |
| [Demo](./docs/DEMO.md) | VS Code–style workbench and keys |
| [npm](./docs/NPM.md) | Install into VFS, intercepts, lockfile |
| [Tailwind](./docs/TAILWIND.md) | Same npm packages + CLI shape |
| [Limits](./docs/LIMITS.md) | Which packages actually `require()` |
| [Architecture](./docs/ARCHITECTURE.md) / [FAQ](./docs/FAQ.md) | Design and short answers |

npm package blurb (what the registry shows): [`packages/api/README.md`](./packages/api/README.md).

---

## What works today

| Capability | State |
|------------|--------|
| C++/WASM kernel (VFS, spawn, shell) | ✅ |
| QuickJS guest Node (embed, not host JS) | ✅ subset |
| npm install → VFS (HTTPS registry allowlist) | ✅ hoist, lockfile, logs |
| Host intercept `npm` / `npx tailwindcss` | ✅ |
| Tailwind packages + browser utilities in preview | ✅ not native oxide CLI |
| Service Worker HTTP preview | ✅ |
| In-tab Vite / Next | ✅ **subset** (esbuild-wasm + shims) |
| ZIP upload → unpack → preview | ✅ |
| OPFS persist `/home` | ✅ |
| `WebContainer` name shim | ✅ |
| Native `.node` addons, bit-identical Node, full Vite 8 / `next start` | ❌ |
| Raw TCP to the public internet from guest | ❌ (virtual HTTP / allowlisted fetch) |

Design: [`ROADMAP.md`](./ROADMAP.md), [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), [`docs/FAQ.md`](./docs/FAQ.md). API: [`docs/API.md`](./docs/API.md).

---

## Use the npm package

```bash
npm install @foisal/nodebrowser
```

Quick start on npm: **[`packages/api/README.md`](./packages/api/README.md). Full method list: [`docs/API.md`](./docs/API.md).

---

## Run the demo from source

```bash
git clone --recurse-submodules https://github.com/foisalislambd/NodeBrowser.git
cd NodeBrowser

# Optional: toolchain (Node, CMake, Ninja, Emscripten) — see scripts/setup-toolchain.sh
npm install
npm run build:api
npm run build:demo
npm run dev          # http://localhost:5173 (COOP/COEP enabled)
```

If you skipped `--recurse-submodules`:

```bash
git submodule update --init --recursive
# or
bash scripts/fetch-deps.sh
```

### Native kernel tests

```bash
npm run build:native   # CMake + QuickJS tests
npm test
```

### WASM (required for a real `boot()`)

```bash
bash scripts/setup-toolchain.sh
source ~/tools/emsdk/emsdk_env.sh   # Git Bash / WSL; on Windows use the emsdk docs
npm run build:wasm
npm run build:api
```

### Host Vite / Next template apps (real Node, for comparison)

```bash
npm run dev:vite
npm run dev:next
```

Templates live under [`demo/templates/`](./demo/templates/). Those **are** normal PC Node apps. The in-tab templates are copies loaded into the VFS.

---

## How the pieces fit

```
Browser tab (ideally COOP + COEP)
  ├─ Demo UI — VS Code–style workbench (editor, terminal, Simple Browser)
  ├─ @foisal/nodebrowser  ← you import this
  │     npm fetch, Tailwind CLI intercept, esbuild-wasm, OPFS, SW bridge
  ├─ Service Worker       ← preview iframe ↔ virtual HTTP ports
  └─ browsernode_kernel.wasm
        ├─ VFS (files in RAM, optional OPFS persist)
        ├─ Processes (spawn, pipes, kill tree)
        └─ QuickJS + Node-ish core modules
```

| Path | Role |
|------|------|
| `kernel/` | C++ VFS, processes, C ABI, QuickJS node runner |
| `vendor/` | QuickJS (git submodule) |
| `packages/api/` | `@foisal/nodebrowser` — TypeScript host API + published WASM |
| `packages/api/src/npm/` | Registry install into VFS |
| `packages/api/src/bundler/tailwind.ts` | `npx tailwindcss` host path + `@tailwindcss/browser` sync |
| `demo/` | VS Code–like playground + templates |
| `docs/` | [Guides index](./docs/README.md) — API, demo, npm, Tailwind, architecture |
| `scripts/` | WASM build, guest-module codegen, toolchain, release helpers |

---

## npm publishing (maintainers)

| Package | Name | Notes |
|---------|------|--------|
| Host API | **`@foisal/nodebrowser`** | Published on every `main` push |
| Monorepo root | `nodebrowser-monorepo` | `"private": true` — do **not** publish |
| Demo | `demo` | Local only — do **not** publish |

Push to **`main`** builds, publishes to **npm** (Trusted Publisher / OIDC) and **GitHub Packages**, then creates a **GitHub Release**.

Guides: [`docs/PUBLISHING.md`](./docs/PUBLISHING.md), [`docs/RELEASING.md`](./docs/RELEASING.md).

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md).

Bug reports and ideas: [GitHub Issues](https://github.com/foisalislambd/NodeBrowser/issues). Security: [`SECURITY.md`](./SECURITY.md).

---

## License

[MIT](./LICENSE) — © 2026 NodeBrowser contributors.

QuickJS retains its own license — see [`vendor/quickjs/LICENSE`](./vendor/quickjs/LICENSE).
