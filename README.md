# BrowserNode

**WebContainers-style Node.js runtime in the browser — core in C/C++ → WebAssembly.**

Run `node`, a virtual filesystem, CommonJS `require`, npm install into a VFS, and HTTP preview — entirely in the tab. No remote compute server.

[![CI](https://github.com/browsernode/browsernode/actions/workflows/ci.yml/badge.svg)](https://github.com/browsernode/browsernode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](./package.json)

> **Note:** Replace the CI badge org/repo path with your GitHub URL after publishing.

```ts
import { BrowserNode } from '@browsernode/api';

const bn = await BrowserNode.boot();
await bn.mount({
  home: {
    directory: {
      project: {
        directory: {
          'index.js': { file: { contents: "console.log('hi from BrowserNode')" } },
        },
      },
    },
  },
});
const proc = await bn.spawn('node', ['/home/project/index.js'], { cwd: '/home/project' });
for await (const chunk of proc.output) console.log(chunk);
```

## Features

| Capability | State |
|------------|--------|
| In-memory VFS | ✅ |
| Process spawn + stdio | ✅ |
| QuickJS (native) + JS fallback (browser) | ✅ |
| Node builtins (`fs`, `path`, `http`, `crypto`, …) | ✅ subset |
| npm install → VFS | ✅ |
| Service Worker HTTP preview | ✅ |
| esbuild-wasm bundle | ✅ |
| Demo file manager (browse / save / run) | ✅ |
| Vite / Next templates (host CLI) | ✅ demos |
| Full Vite/Next CLI in-tab | 🔜 |

Honest roadmap & architecture: [`PLAN.md`](./PLAN.md), [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), [`docs/FAQ.md`](./docs/FAQ.md).

## Quick start

```bash
git clone --recurse-submodules https://github.com/YOUR_ORG/browsernode.git
cd browsernode

# Optional: toolchain (Node, CMake, Ninja, Emscripten) — see scripts/setup-toolchain.sh
npm install
npm run build:api
npm run build:demo
npm run dev          # http://localhost:5173 (COOP/COEP enabled)
```

Without a WASM build, the API **falls back to an in-browser JS runtime** — enough for the demo and most host API work.

### Native kernel tests

```bash
npm run build:native   # CMake + QuickJS tests
npm test
```

### WASM (optional)

```bash
bash scripts/setup-toolchain.sh
source ~/tools/emsdk/emsdk_env.sh
npm run build:wasm
npm run build:api
```

### Host Vite / Next template apps

```bash
npm run dev:vite
npm run dev:next
```

Templates live under [`demo/templates/`](./demo/templates/).

## Repository layout

```
kernel/           C++ VFS, processes, C ABI, QuickJS node runner
vendor/           QuickJS (git submodule)
packages/api/     @browsernode/api (TypeScript host API)
demo/             Playground UI + templates
docs/             Architecture & guides
scripts/          build-wasm, serve-demo, setup-toolchain, …
```

```bash
git submodule update --init --recursive
# or
bash scripts/fetch-deps.sh
```

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Please read the [Code of Conduct](./CODE_OF_CONDUCT.md).

Bug reports and ideas: use [GitHub Issues](../../issues). Security: [`SECURITY.md`](./SECURITY.md).

## Design

Shipping full Node+V8+libuv to WASM is a multi-year effort. BrowserNode embeds **QuickJS** (and a JS fallback) behind a C++/host kernel and grows Node compatibility incrementally — aimed at real `npm` / tooling workflows over time.

## License

[MIT](./LICENSE) — © 2026 BrowserNode contributors.

QuickJS retains its own license — see [`vendor/quickjs/LICENSE`](./vendor/quickjs/LICENSE).
