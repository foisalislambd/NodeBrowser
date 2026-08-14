# NodeBrowser

**Run Node-like JavaScript in the browser tab — filesystem, `require`, npm, and HTTP preview included.**

No remote compute box. The “server” is a **C++ kernel compiled to WebAssembly** sitting in the same tab as your UI.

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

---

## What is this, in plain words?

Imagine StackBlitz / WebContainers: you open a page, there is a terminal, you type `node index.js` or `npm install`, and it works **without SSH-ing to a Linux VM**.

NodeBrowser is that idea as **open source**:

1. You load a WASM module (the kernel).
2. The kernel owns a **virtual disk** (`/home/project/...`) and **virtual processes**.
3. Guest JavaScript runs in **QuickJS inside that WASM**, with Node-ish `fs`, `http`, `require`, …
4. The TypeScript package (`@foisal/nodebrowser`) is only the **host**: load WASM, fetch npm tarballs, talk to a Service Worker for preview iframes.

Your laptop’s real `node_modules` and real Node are not involved (unless you clone this repo and run the demo with Vite on the host).

---

## Why does it exist?

Shipping **full Node + V8 + libuv** to WebAssembly is a multi-year port. Proprietary products already do a polished version of “Node in the tab,” but you cannot audit or fork them.

NodeBrowser takes a different bet:

- **One kernel in C/C++**, not a fake Node written twice (once in JS, once in WASM).
- **QuickJS** as the guest engine — small enough to embed, good enough for a growing Node subset.
- **Honest docs** about what works today vs what is still a subset (Vite/Next, speed vs V8).
- **Agent-friendly API** (`boot` / `fs` / `spawn` / `install` / `rpc`) so tools can drive the runtime without the demo UI.

If you want an auditable playground, in-tab ZIP → preview, or a sandbox for coding agents, this is the project.

What we are **not** trying to be on day one: bit-identical Node, native `.node` addons, a hardened multi-tenant malware jail, or a clone of WebContainers’ internals.

---

## What works today

| Capability | State |
|------------|--------|
| C++/WASM kernel (VFS, spawn, shell) | ✅ |
| QuickJS guest Node (embed, not host JS) | ✅ subset |
| npm install → VFS (HTTPS registry allowlist) | ✅ |
| C++ `npm` / `npx` / kill-tree | ✅ |
| Service Worker HTTP preview | ✅ |
| In-tab Vite / Next | ✅ **subset** (esbuild-wasm + shims) |
| ZIP upload → unpack → preview | ✅ |
| `WebContainer` name shim | ✅ |
| Full Vite/Next CLI in QuickJS | 🔜 |

Roadmap and design: [`PLAN.md`](./PLAN.md), [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), [`docs/FAQ.md`](./docs/FAQ.md).

---

## Use the npm package

```bash
npm install @foisal/nodebrowser
```

Full install, boot, VFS, npm, preview, and API map: **[`packages/api/README.md`](./packages/api/README.md)** (this is also what npm shows).

Browser pages that want Worker + `SharedArrayBuffer` stdio should send:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`NodeBrowser.boot()` loads the **C++/WASM** kernel and **throws** if `browsernode_kernel.wasm` is missing. There is no JavaScript guest Node.

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

Templates live under [`demo/templates/`](./demo/templates/).

---

## How the pieces fit

```
Browser tab (ideally COOP + COEP)
  ├─ Demo UI (editor, terminal)
  ├─ @foisal/nodebrowser  ← you import this
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
| `demo/` | Playground UI + templates |
| `docs/` | Architecture, publishing, FAQ |
| `scripts/` | WASM build, demo server, toolchain, release helpers |

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

Bug reports and ideas: [GitHub Issues](../../issues). Security: [`SECURITY.md`](./SECURITY.md).

---

## License

[MIT](./LICENSE) — © 2026 NodeBrowser contributors.

QuickJS retains its own license — see [`vendor/quickjs/LICENSE`](./vendor/quickjs/LICENSE).
