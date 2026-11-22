# NodeBrowser

**A Node-like runtime in the browser tab.** Filesystem, `require`, npm, and HTTP preview run on a C++ kernel compiled to WebAssembly — in the same tab as the page.

[![CI](https://github.com/foisalislambd/NodeBrowser/actions/workflows/ci.yml/badge.svg)](https://github.com/foisalislambd/NodeBrowser/actions/workflows/ci.yml)
[![Release](https://github.com/foisalislambd/NodeBrowser/actions/workflows/release.yml/badge.svg)](https://github.com/foisalislambd/NodeBrowser/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@foisal/nodebrowser.svg)](https://www.npmjs.com/package/@foisal/nodebrowser)
[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](./package.json)

<p>
  <a href="https://foisalislambd.github.io/NodeBrowser/"><strong>Live demo</strong></a>
  &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/@foisal/nodebrowser"><strong>npm</strong></a>
  &nbsp;·&nbsp;
  <a href="./docs/README.md"><strong>Docs</strong></a>
  &nbsp;·&nbsp;
  <a href="./docs/API.md"><strong>API</strong></a>
</p>

```bash
npm install @foisal/nodebrowser
```

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
bn.teardown();
```

---

## Three layers

| Layer | Where it lives | What it does |
| --- | --- | --- |
| **Kernel** | `browsernode_kernel.wasm` | Virtual disk, processes, pipes, shell |
| **Guest Node** | QuickJS inside that WASM | `fs`, `http`, `require`, `child_process`, … |
| **Host** | `@foisal/nodebrowser` | Boot, npm fetch, OPFS, Service Worker preview |

Guest JavaScript runs on QuickJS inside the kernel. The TypeScript package loads WASM, fetches packages, and bridges preview iframes. Optional `boot({ guestEngine: 'v8' })` runs the same guest modules on host V8. The default path is QuickJS.

Open a page, type `node index.js` or `npm install`, and it runs without a remote Linux VM. The demo is a VS Code–style workbench: editor, terminal, and a Simple Browser for the virtual server.

---

## Guest Node

Coverage is a Node 20-shaped subset aimed at tooling (Vite first, then Next). Full table: [`runtime/node/MODULES.md`](./runtime/node/MODULES.md).

| Module | Today |
| --- | --- |
| `fs` / `fs/promises` | Read, write, mkdir, cp, rm, symlink, chmod, utimes, watch, and file descriptors (`openSync`, `readSync`, `writeSync`, `closeSync`, `fstatSync`, `promises.open`) |
| `module` | CommonJS `require`, `createRequire`, the `exports` field, ESM rewrite |
| `http` / `https` | `createServer` plus `request` / `get` to a virtual server on localhost |
| `child_process` | `spawn` / `execFile` pass script arguments and `env` |
| `stream` | Readable, Writable, `pipe`, `pipeline`, `finished` |
| `crypto` | Hashes and HMAC (`sha1`, `sha256`, `sha384`, `sha512`), `timingSafeEqual`, `randomBytes` |
| `readline` | `createInterface` splits input into `line`; `question` waits for the next line |
| `process` | `cwd`, `argv`, `env`, `exit`, `nextTick`, stdin `data` events |
| `zlib`, `buffer`, `path`, `assert`, `url`, `util` | Present as subsets. `path` is POSIX |

Still outside this subset: native `.node` addons, `crypto.createCipheriv`, raw TCP to the public internet, and a bit-identical Node. Virtual HTTP stays on localhost. npm fetch uses an allowlisted HTTPS registry.

---

## Host package

| Capability | State |
| --- | --- |
| `boot` / `mount` / `spawn` / `fs` / `teardown` | Ready |
| npm install into the VFS (hoist, lockfile, `.npmrc`, peers, workspaces) | Ready |
| `WebContainer`-shaped public API (`boot`, `mount`, `spawn`, `fs`, events, `export`) | Subset — see [Migrating](./docs/MIGRATING.md) |
| Service Worker preview, ZIP in and out, OPFS persist for `/home` | Ready |
| Search, replace, glob, diff, watch, public GitHub import | Ready |
| In-tab Vite / Next | Subset (esbuild-wasm plus shims) |
| Tailwind | Same packages and CLI shape; the native oxide binary is not bundled |
| Native addons, full Vite 8, `next start` | Not in this runtime |

---

## Docs

| Guide | Read it for |
| --- | --- |
| [User guide](./docs/GUIDE.md) | VFS, language law, terminal, persist |
| [API](./docs/API.md) | Every host method, event, and RPC call |
| [Demo](./docs/DEMO.md) | Workbench layout and keys |
| [npm](./docs/NPM.md) | Install, intercepts, lockfiles |
| [Tailwind](./docs/TAILWIND.md) | CLI shape inside the tab |
| [Limits](./docs/LIMITS.md) | Which packages actually `require()` |
| [Architecture](./docs/ARCHITECTURE.md) | Kernel, host, and teardown |
| [Migrating](./docs/MIGRATING.md) | Coming from WebContainers |
| [FAQ](./docs/FAQ.md) | Short answers |

The text npm shows is [`packages/api/README.md`](./packages/api/README.md).

---

## Benchmark

Measured **9 Nov 2026** on the committed WASM kernel (2,369,166 bytes), Node v26.13.0, Linux, AMD Ryzen 7 7700 (8 cores, 9.6 GiB). Same kernel the browser loads. This is a warm Node process, not a cold page load.

Every check passed. Figures are the median of 5 rounds after one warmup. Boot is the median of 3 cold boots.

| Check | Result | Median |
| --- | ---: | ---: |
| Boot the WASM kernel | ok | 11.3 ms |
| `node -e` printing `ok` | ok | 29.6 ms |
| Write then read 64 KiB | ok | 8.3 ms |
| Write 100 small files | ok | 6.6 ms |
| `require` a local module | ok, value `42` | 20.3 ms |
| 1,000,000-iteration loop, guest `node` | ok, checksum `6` | 221.7 ms |
| Same loop, a host Node process | same checksum | 87.2 ms |
| Same loop, V8 in this process | same checksum | 5.0 ms |

Guest `node` for that loop took about 2.5× a real Node process (222 ms vs 87 ms). The arithmetic itself is 5.0 ms on in-process V8. Most of the guest time is starting QuickJS inside WASM.

```bash
npx tsc -p packages/api/tsconfig.json
npm run bench
```

Source: [`scripts/bench.mjs`](./scripts/bench.mjs).

---

## Run from source

```bash
git clone --recurse-submodules https://github.com/foisalislambd/NodeBrowser.git
cd NodeBrowser
npm install
npm run build:api
npm run build:demo
npm run dev          # http://localhost:5173  (COOP/COEP on)
```

If the clone skipped submodules:

```bash
git submodule update --init --recursive
```

Native kernel tests, then a WASM image so `boot()` matches the source you just edited:

```bash
npm run build:native
npm test

bash scripts/setup-toolchain.sh
source ~/tools/emsdk/emsdk_env.sh   # Git Bash / WSL; Windows: emsdk_env.bat
npm run build:wasm
npm run build:api
```

Host Vite and Next templates (real Node on your machine, for comparison) live in [`demo/templates/`](./demo/templates/):

```bash
npm run dev:vite
npm run dev:next
```

Serve the browser page with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` when you want the kernel Worker and `SharedArrayBuffer` stdio. `npm run dev` sets those headers. Without them the kernel still boots and stdio falls back to polling.

---

## Layout

```
Browser tab
├─ demo/                  VS Code–style workbench
├─ @foisal/nodebrowser    boot, npm, OPFS, preview bridge
├─ Service Worker         preview iframe ↔ virtual HTTP
└─ browsernode_kernel.wasm
      ├─ VFS              RAM, optional OPFS for /home
      ├─ Processes        spawn, pipes, kill
      └─ QuickJS          Node-shaped core modules
```

| Path | Role |
| --- | --- |
| `kernel/` | C++ VFS, processes, QuickJS runner |
| `kernel/embed/guest_modules.js` | Guest Node modules baked into the kernel |
| `vendor/quickjs` | QuickJS submodule |
| `packages/api/` | Published `@foisal/nodebrowser` package and WASM |
| `demo/` | Playground and templates |
| `docs/` | Guides |
| `scripts/` | WASM build, guest codegen, release helpers |

New guest APIs belong in `kernel/embed/guest_modules.js` (and a C++ `__bn` binding when the kernel must do the work). The host package stays boot, mount, spawn, npm, OPFS, and the preview bridge.

---

## Publishing

| Package | Name | |
| --- | --- | --- |
| Host API | `@foisal/nodebrowser` | Published from `main` |
| Monorepo root | `nodebrowser-monorepo` | Private |
| Demo | `demo` | Local only |

A push to `main` builds, publishes to npm (Trusted Publisher) and GitHub Packages, and opens a GitHub Release when [`VERSION.md`](./VERSION.md) is newer than the latest tag. See [`docs/PUBLISHING.md`](./docs/PUBLISHING.md) and [`docs/RELEASING.md`](./docs/RELEASING.md).

---

## Contributing

[`CONTRIBUTING.md`](./CONTRIBUTING.md) · [Code of Conduct](./CODE_OF_CONDUCT.md) · [Issues](https://github.com/foisalislambd/NodeBrowser/issues) · [`SECURITY.md`](./SECURITY.md)

## License

[MIT](./LICENSE) © 2026 NodeBrowser contributors.

QuickJS keeps its own license: [`vendor/quickjs/LICENSE`](./vendor/quickjs/LICENSE).
