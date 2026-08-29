# `@foisal/nodebrowser`

**Node.js-style runtime in the browser tab.** No remote VM. No cloud compute.

This is the public TypeScript API for [NodeBrowser](https://github.com/foisalislambd/NodeBrowser). It loads a **C++ kernel compiled to WebAssembly**, then lets you mount a virtual filesystem, `spawn('node', …)`, install npm packages into that VFS, and preview HTTP servers — all inside the page.

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

[Live demo](https://foisalislambd.github.io/NodeBrowser/) · [GitHub](https://github.com/foisalislambd/NodeBrowser) · **[API reference](https://github.com/foisalislambd/NodeBrowser/blob/main/docs/API.md)** · [Docs index](https://github.com/foisalislambd/NodeBrowser/blob/main/docs/README.md)

---

## Why this package

StackBlitz WebContainers proved that “Node in the tab” is useful: playgrounds, docs with a live terminal, agent sandboxes, ZIP → preview. Those internals are proprietary.

NodeBrowser is an **open-source, auditable** alternative:

| Layer | What it is |
| ----- | ---------- |
| Kernel | C/C++ → WASM: VFS, processes, pipes, spawn, shell |
| Guest JS | **QuickJS inside WASM** (not your page’s JS engine) |
| This package | Host glue: load WASM, call the C ABI, npm `fetch`, Service Worker preview |

TypeScript here is **not** a second Node. Guest `fs` / `require` / `http` live in the kernel.

---

## Install

```bash
npm install @foisal/nodebrowser
```

Requires **Node 20+** to build apps that depend on this package. The runtime itself is meant for **browsers** (and can also boot in Node for headless scripts).

### Cross-origin isolation (browser)

For a Worker + `SharedArrayBuffer` stdio rings (so long `node` jobs do not freeze the UI), serve your page with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without those headers, the kernel still boots; stdio falls back to polling.

---

## Quick start

### 1. Boot the kernel

`boot()` loads `browsernode_kernel.wasm` (shipped in this package under `wasm/`). It **throws** if the WASM file cannot be loaded.

```ts
const bn = await NodeBrowser.boot({
  // wasmUrl: '/custom/path/browsernode_kernel.wasm', // optional
  persist: false, // true → keep /home in Origin Private File System
});
```

### 2. Put files in the VFS

Paths are POSIX (`/home/project/...`). They are **not** your laptop’s disk.

```ts
await bn.mount(
  {
    'package.json': {
      file: {
        contents: JSON.stringify({
          name: 'demo',
          type: 'module',
          dependencies: { leftpad: '1.1.1' },
        }),
      },
    },
    'index.js': { file: { contents: "import leftpad from 'leftpad';\nconsole.log(leftpad('hi', 5))" } },
  },
  '/home/project',
);

// or write files one by one
await bn.fs.mkdir('/home/project', { recursive: true });
await bn.fs.writeFile('/home/project/hello.js', "console.log('ok')");
```

### 3. Install npm packages into the VFS

Packages land in `/home/project/node_modules`, fetched over HTTPS from the npm registry (allowlisted). Your host `node_modules` is untouched.

```ts
bn.on('install-progress', (p) => console.log(p.phase, p.name, p.message ?? ''));
await bn.install([], '/home/project'); // empty list → package.json deps
// or: await bn.install(['lodash@4'], '/home/project');
```

### 4. Spawn processes

```ts
const proc = await bn.spawn('node', ['index.js'], { cwd: '/home/project' });
proc.write('stdin if the program reads it\n');
for await (const chunk of proc.output) console.log(chunk);
const code = await proc.exit;
proc.kill(); // or bn.killTree(proc.pid)
```

Useful commands the kernel understands: `node`, `sh`, `npm`, `npx`, and bins under `node_modules/.bin` after install.

### 5. Preview HTTP (optional)

When guest code listens on a port, you get a `server-ready` event. Wire a Service Worker so the iframe can hit `/__bn_preview/<port>/…`.

```ts
bn.on('server-ready', (port, url) => {
  console.log('preview', port, url);
});

// After your SW is registered:
bn.attachServiceWorkerBridge('/__bn_preview');
```

In-tab **Vite / Next are a subset** (esbuild-wasm + shims), not bit-identical CLIs:

```ts
await bn.viteDev('/home/project');
await bn.nextDev('/home/project');
await bn.previewProject('/home/project');
```

### 6. Tear down

```ts
bn.teardown();
```

---

## API map

| You want to… | Use |
| ------------ | --- |
| Start the runtime | `NodeBrowser.boot(options?)` |
| Drop a file tree in | `bn.mount(tree, mountPoint?)` |
| Read / write VFS | `bn.fs` (`readFile`, `writeFile`, `mkdir`, `rm`, `rename`, `exists`, …) |
| Run Node / shell | `bn.spawn(cmd, args, { cwd, env })` |
| npm install | `bn.install(packages, cwd)` |
| `npm run` | `bn.runScript(name, cwd)` |
| `npx` | `bn.npx(pkg, args, cwd)` |
| Tailwind CLI shape | `bn.compileTailwind(cwd, args)` or `spawn('npx', ['tailwindcss', '-i', …])` |
| ZIP / tar.gz → VFS | `bn.importZip(bytes, dest?)` |
| Snapshot `/home` | `bn.exportSnapshot()` / `bn.importSnapshot(bytes)` |
| Persist `/home` | `boot({ persist: true })` (OPFS) |
| Preview URL | `server-ready` event, `bn.serveStatic(port, root)` |
| Agent-style calls | `bn.rpc({ method, params })` |
| Stop everything | `bn.teardown()` |

**Events:** `server-ready`, `install-progress`, `fs-change`, `http-log`, `error`.

### WebContainer name shim

Same kernel, StackBlitz-shaped names. Extra APIs (`install`, `viteDev`, `importZip`, …) live on `.instance`.

```ts
import { WebContainer } from '@foisal/nodebrowser/compat';
// or: import { WebContainer } from '@foisal/nodebrowser';

const wc = await WebContainer.boot();
await wc.mount({ /* FileSystemTree */ });
await wc.spawn('node', ['app.js']);
wc.instance.install(['leftpad'], '/home/project');
```

This is **not** a drop-in for `@webcontainer/api`. Method names overlap; behavior and coverage differ.

---

## Headless (Node)

After a local build, or from the published package:

```js
import { NodeBrowser } from '@foisal/nodebrowser';

const bn = await NodeBrowser.boot();
await bn.fs.mkdir('/home/agent', { recursive: true });
await bn.fs.writeFile('/home/agent/hi.js', "console.log('agent-ok')");
const proc = await bn.spawn('node', ['/home/agent/hi.js'], { cwd: '/home/agent' });
for await (const chunk of proc.output) process.stdout.write(chunk);
bn.teardown();
```

Repo example: [`examples/headless.mjs`](https://github.com/foisalislambd/NodeBrowser/blob/main/examples/headless.mjs).

---

## Honest limits

- Guest JS is **QuickJS**, not V8. Speed and Node compatibility are a **growing subset**.
- Native `.node` addons, full `libuv`/V8 Node, and bit-identical Vite 8 / `next start` are **out of scope** for now.
- Isolation is **best-effort** for demos and tooling — not a hardened multi-tenant sandbox. See [SECURITY.md](https://github.com/foisalislambd/NodeBrowser/blob/main/SECURITY.md).
- `npm install` talks to the **public npm registry** over HTTPS. Yarn/pnpm lockfiles are detected but **not executed**.

Full API: [docs/API.md](https://github.com/foisalislambd/NodeBrowser/blob/main/docs/API.md). Limits: [docs/LIMITS.md](https://github.com/foisalislambd/NodeBrowser/blob/main/docs/LIMITS.md). FAQ: [docs/FAQ.md](https://github.com/foisalislambd/NodeBrowser/blob/main/docs/FAQ.md).

---

## Package layout (this folder)

```
src/          TypeScript host (boot, fs bridges, npm fetch, bundler glue)
wasm/         browsernode_kernel.wasm + JS loader (copied on build)
dist/         compiled public API (what `import` resolves to)
```

Kernel source lives in the monorepo (`kernel/`), not in this npm tarball.

---

## License

[MIT](https://github.com/foisalislambd/NodeBrowser/blob/main/LICENSE) — © 2026 NodeBrowser contributors.

QuickJS has its own license in the kernel vendor tree.
