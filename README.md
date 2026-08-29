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
| [What is this](#what-is-this-in-plain-words) | Product in one page |
| [User guide](#user-guide) | Demo as VS Code, terminal, npm, Tailwind, preview |
| [How the pieces fit](#how-the-pieces-fit) | Kernel vs host vs demo |
| [What works / what does not](#what-works-today) | Honest capability table |
| [Run from source](#run-the-demo-from-source) | Clone, WASM, native tests |
| [npm package](#use-the-npm-package) | `@foisal/nodebrowser` API pointer |

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

## User guide

This is the practical guide: how a person (or an agent) should use NodeBrowser, what happens under the hood, and where it deliberately differs from a PC.

### 1. Open the workbench (demo)

The `demo/` app is a **VS Code Dark+–style workbench**, not a custom “cloud IDE” chrome:

- Title bar: File / Edit / View / Run / Terminal / Help, command center (`Ctrl+K`)
- Activity bar: Explorer, Search, Run and Debug, Templates, Simple Browser, Settings
- Sidebar: **PROJECT** tree over the virtual disk (`/home`, `/usr`, …)
- Editor: open file, breadcrumbs, dirty dot, `Ctrl+S` save
- Panel: **PROBLEMS** / **TERMINAL** / **OUTPUT** / **DEBUG CONSOLE**
- Status bar: WASM ready, cwd, line/col, LF, UTF-8
- Right pane: **Simple Browser** (preview iframe + virtual `localhost`)

Boot sequence: splash → WASM kernel → optional OPFS restore of `/home` → welcome text in the terminal. The demo does **not** auto-run an HTTP server on an empty starter workspace; you run files yourself (F5 / Run File), like VS Code.

Local: `npm run dev` → [http://localhost:5173](http://localhost:5173) (COOP/COEP headers required for Worker + SharedArrayBuffer stdio).

### 2. Where files actually live

| Path you type | Where it is |
|---------------|-------------|
| `/home/project/index.js` | Kernel **VFS** (RAM). Optional persist: browser **OPFS** for `/home` |
| `node_modules/` after `npm install` | Same VFS: `/home/project/node_modules` |
| This git repo’s `node_modules/` | Host machine only (Vite, Emscripten, tests) — **not** the guest |

Explorer, Save, Upload ZIP, and the terminal all talk to the **same VFS**. Export snapshot / import ZIP copy bytes in and out of that disk.

### 3. Language law (who is allowed to implement Node)

| Layer | Language | Allowed to implement |
|-------|----------|----------------------|
| Guest Node (`fs`, `http`, `require`, `child_process`, …) | **C++ + QuickJS** in `kernel/` and `kernel/embed/guest_modules.js` | Yes |
| Host package `@foisal/nodebrowser` | **TypeScript** | WASM load, npm **fetch**, OPFS, Service Worker, esbuild-wasm / preview shims — **not** a second Node |
| Demo UI | **JavaScript** in `demo/src` | Workbench only |

New core modules go in the kernel embed, then regenerate (`scripts/gen-guest-modules.sh`). Do not add a fake `fs` in the demo.

### 4. Terminal: same commands as a PC (subset)

Type in the panel like a shell. The demo runs `spawn('sh', ['-c', line], { cwd })`.

**Node**

```bash
node index.js
node /home/project/server.js
```

Guest JS is **QuickJS inside WASM**, not Chromium’s V8 and not your laptop Node.

**npm (host installer, packages still land in the VFS)**

The workbench intercepts `npm` / `sh -c 'npm …'` on the **host** so install logs stream to the terminal and the old WASM keep-alive/kill-137 path is avoided. Behavior is meant to feel like a PC:

```bash
npm install
npm install lodash
npm install tailwindcss @tailwindcss/browser
npm install -D typescript
npm uninstall lodash
npm ls
npm run <script>
```

What that means:

- Tarballs come from the **npm registry** (HTTPS allowlist).
- Extract + hoist into **`/home/project/node_modules`** (you see them in Explorer).
- `package.json` and a lockfile are updated.
- Dependencies are fetched in parallel; exact versions already present are skipped.
- **Native / optional platform packages are skipped** (e.g. `esbuild`, `fsevents`, `lightningcss-*`, `@tailwindcss/oxide*`) because they are `.node` binaries. The JS package still installs when it is pure JS.
- Peer deps are **not** auto-installed (npm-like warning, not silent install).
- Empty `npm install` installs `package.json` dependencies.

Command parsing uses the **first positional** as the subcommand (`npm install ls` is install of a package named `ls`, not `npm ls`).

**npx / local bins**

```bash
npx tailwindcss -i ./src/input.css -o ./dist/output.css
```

`node_modules/.bin` shims exist after install. Some CLIs are intercepted on the host when the real binary cannot run in WASM (Tailwind, npm). Others run as `node path/to/cli.js` in QuickJS when that JS is compatible.

Pipes and `&&` / `;` in one `sh -c` string are **not** rewritten by the host intercept (too easy to mis-parse). Prefer one command per line.

### 5. Tailwind CSS — no separate Tailwind product

Goal: **install Tailwind like a PC, compile with the same CLI shape**, without a second “in-browser Tailwind engine” product beside npm.

**Install (same as PC)**

```bash
npm install tailwindcss @tailwindcss/browser
```

or the Run sidebar: **Install Tailwind CSS**. Packages go into the project `node_modules`.

**Compile (same CLI people already type)**

```bash
npx tailwindcss -i ./src/input.css -o ./dist/output.css
```

or **Compile Tailwind** in Run and Debug. Flags `-y` / `--yes` / `tailwindcss@4` are accepted. If `-i` is missing, the host looks for `src/input.css`, `src/index.css`, `input.css`, … and creates `src/input.css` when needed.

What actually happens (honest):

1. Host intercepts `tailwindcss` / `npx tailwindcss` (not the native Rust/oxide CLI).
2. Native **lightningcss** / **@tailwindcss/oxide** are skipped on install — they cannot run in WASM.
3. `@tailwindcss/browser` (the official browser compiler) is copied from VFS `node_modules` into `/usr/share/nodebrowser/tailwind-browser.js` when `index.global.js` exists. The demo also ships a vendor copy of that IIFE for first paint.
4. `dist/output.css` is your source CSS **minus** `@import "tailwindcss"` (plus a short header). It is **not** a full pre-generated utility dump like native `lightningcss`.
5. **Utilities apply in Simple Browser**: preview HTML injects `<style type="text/tailwindcss">` and the browser compiler, same as Tailwind’s documented browser path.

So: same **packages**, same **commands**, same **files in the project**. Not bit-identical to `tailwindcss` on Linux with oxide. Do not expect `output.css` on disk to contain every `flex`/`pt-4` class; the preview engine generates those in the iframe.

The **demo workbench’s own CSS** uses Tailwind via Vite (`@tailwindcss/vite` in `demo/`). That only styles the VS Code chrome. Guest apps do not use that pipeline.

### 6. Run, debug, preview

- **Run File (F5)** — `node` on the open `.js` (or writes `index.js`).
- **HTTP Demo** — sample `http` server; Simple Browser maps `localhost:3000` through the Service Worker.
- **Preview Project** — detects Vite / Next / static / Node and starts the in-tab subset.
- **Bundle (esbuild-wasm)** — host bundler, files still in VFS.
- **Templates** — load Vite / Next / Express trees into `/home/project`, then preview.

When guest code `listen()`s, the host fires `server-ready` and the iframe loads `/__bn_preview/<port>/`.

### 7. Keyboard (demo)

| Keys | Action |
|------|--------|
| `Ctrl+K` | Command palette |
| `Ctrl+S` | Save |
| `Ctrl+N` | New file |
| `Ctrl+J` | Toggle panel |
| `` Ctrl+` `` | Focus terminal |
| `Ctrl+Shift+E` / `F` / `D` | Explorer / Search / Run |
| `F5` | Run file |

**Install Package…** uses a VS Code-style quick input (Enter confirms, Escape cancels), not `window.prompt`.

### 8. Persist and share

- `boot({ persist: true })` (demo default): `/home` survives reloads via OPFS.
- Export snapshot / Upload ZIP: move a project in or out of the tab.
- Clearing the workspace wipes VFS `/home` (and OPFS when persist is on).

### 9. Use it from your own app (no demo UI)

Full API: [`packages/api/README.md`](./packages/api/README.md).

```ts
const bn = await NodeBrowser.boot({ persist: true, previewBase: '/__bn_preview' });
bn.attachServiceWorkerBridge('/__bn_preview');
bn.on('install-progress', (p) => console.log(p.message ?? p.phase));
await bn.install(['lodash'], '/home/project');
await bn.spawn('node', ['index.js'], { cwd: '/home/project' });
await bn.compileTailwind('/home/project', ['-i', './src/input.css', '-o', './dist/output.css']);
```

Serve the page with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`NodeBrowser.boot()` **throws** if `browsernode_kernel.wasm` is missing. There is no JavaScript guest Node fallback.

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

Design: [`ROADMAP.md`](./ROADMAP.md), [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), [`docs/FAQ.md`](./docs/FAQ.md).

---

## Use the npm package

```bash
npm install @foisal/nodebrowser
```

Install, boot, VFS, npm, preview, and API map: **[`packages/api/README.md`](./packages/api/README.md)** (this is also what npm shows).

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
| `docs/` | Architecture, publishing, FAQ |
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
