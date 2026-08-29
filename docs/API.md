# API reference — `@foisal/nodebrowser`

Public TypeScript host for the C++/WASM kernel. Guest Node (`fs`, `require`, `http`) lives **in the kernel**, not in this package.

Install: `npm i @foisal/nodebrowser`  
Package README (npm page): [../packages/api/README.md](../packages/api/README.md)  
User guide: [GUIDE.md](./GUIDE.md)

```ts
import { NodeBrowser } from '@foisal/nodebrowser';

const bn = await NodeBrowser.boot();
await bn.fs.mkdir('/home/project', { recursive: true });
await bn.fs.writeFile('/home/project/hi.js', "console.log('ok')");
const proc = await bn.spawn('node', ['hi.js'], { cwd: '/home/project' });
for await (const chunk of proc.output) console.log(chunk);
await proc.exit;
bn.teardown();
```

---

## Imports

```ts
import {
  NodeBrowser,      // main class
  WebContainer,     // name shim (not StackBlitz)
  BrowserNode,      // alias of NodeBrowser
  HttpBridge,
  resetKernelCache,
  sabStdioAvailable,
  SabStdioRing,
  assertAllowedFetchUrl,
  detectProjectKind,
  resolveProjectRoot,
  extractArchive,
  isZip,
  isGzip,
  handleAgentRpc,
} from '@foisal/nodebrowser';

import { WebContainer } from '@foisal/nodebrowser/compat'; // same shim
```

---

## `NodeBrowser.boot(options?)`

Loads `browsernode_kernel.wasm` (from the package `wasm/` folder, or `wasmUrl`). **Throws** if WASM is missing. `useWasm: false` also throws (`WASM kernel required`).

| Option | Type | Default | Meaning |
|--------|------|---------|---------|
| `wasmUrl` | `string` | packaged wasm | Custom URL/path to the kernel |
| `previewBase` | `string` | `{origin}/__bn_preview` | Prefix for preview URLs |
| `persist` | `boolean` | `false` | Hydrate/flush `/home` via OPFS (browser) |
| `useWasm` | `true \| false \| 'auto'` | `true` | Must be WASM; `false` is rejected |

**Instance fields:** `runtime` (`'wasm'`), `worker` (kernel on a Worker), `sabStdio` (SharedArrayBuffer rings), `persistEnabled`.

Browser pages that want Worker + SAB stdio must send:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without those headers the kernel still boots; stdio falls back to polling.

---

## Filesystem — `bn.fs`

POSIX paths (`/home/project/...`). Not the host disk.

| Method | Notes |
|--------|--------|
| `readFile(path, encoding?)` | `'utf8'` (default) → `string`; `'buffer'` → `Uint8Array` |
| `writeFile(path, data)` | `string` or `Uint8Array` |
| `mkdir(path, { recursive? })` | Default recursive `true` on the host wrapper |
| `readdir(path)` | Names in a directory |
| `exists(path)` | `boolean` |
| `stat(path)` | `{ isFile(), isDirectory() }` |
| `rm(path, { recursive? })` | Directories need `{ recursive: true }` |
| `rename(from, to)` | Files or trees |

---

## `bn.mount(tree, mountPoint?)`

WebContainer-style tree. `mountPoint` defaults to `/`.

```ts
await bn.mount(
  {
    'index.js': { file: { contents: "console.log(1)" } },
    src: { directory: { 'a.js': { file: { contents: '' } } } },
  },
  '/home/project',
);
```

`contents` may be `string` or `Uint8Array`.

---

## Processes — `bn.spawn(cmd, args?, opts?)`

```ts
const proc = await bn.spawn('node', ['index.js'], {
  cwd: '/home/project',
  env: { NODE_ENV: 'development' },
});
proc.write('stdin\n');
for await (const chunk of proc.output) console.log(chunk);
const code = await proc.exit;
proc.kill();
```

`BrowserNodeProcess`: `pid`, `exit` (`Promise<number>`), `output` (`ReadableStream<string>`), `kill()`, `write(string)`.

Host intercepts (same VFS, no native CLI):

- `npm` / `sh -c 'npm …'` → [NPM.md](./NPM.md)
- `tailwindcss` / `npx tailwindcss` / `sh -c 'npx tailwindcss …'` → [TAILWIND.md](./TAILWIND.md)

Also: `node`, `sh`, `npx`, and `node_modules/.bin/*` after install.

`bn.killTree(pid)` — pid plus host-spawned npm/npx children.

`bn.runScript(name, cwd)` — `package.json` `scripts[name]` via `sh -c`.

`bn.npx(pkg, args, cwd)` — run local bin, or install `pkg` then run it.

---

## npm — `bn.install(packages, cwd?, opts?)`

```ts
bn.on('install-progress', (p) => {
  if (!p.streamed) console.log(p.phase, p.name, p.message ?? '');
});
await bn.install(['lodash@4'], '/home/project');
await bn.install([], '/home/project'); // package.json deps
await bn.install(['typescript'], '/home/project', { saveDev: true });
```

`opts`: `saveDev?`, `onLog?(line)`, `logPid?`.

See [NPM.md](./NPM.md).

---

## Tailwind — `bn.compileTailwind(cwd, args?)`

Same flags as the CLI (`-i` / `--input`, `-o` / `--output`).

```ts
await bn.compileTailwind('/home/project', ['-i', './src/input.css', '-o', './dist/output.css']);
```

See [TAILWIND.md](./TAILWIND.md).

---

## Bundlers and preview (subsets)

Not bit-identical Vite 8 / `next start`. Host uses **esbuild-wasm** + VFS.

| Method | Role |
|--------|------|
| `bundle({ entry, outfile, format? })` | esbuild-wasm |
| `viteBuild(cwd, { outDir? })` | In-tab Vite-like build |
| `viteDev(cwd, { port? })` | Dev + static preview |
| `nextBuild(cwd)` / `nextDev(cwd, { port? })` | App Router–ish subset |
| `tsc(cwd, args)` | Installed `typescript/lib/tsc.js` in QuickJS |
| `previewProject(cwd)` | Detect kind and start |
| `resolveProjectRoot(cwd)` | Nested folder with `package.json` / `app` |
| `serveStatic(port, rootDir, { index? })` | Virtual HTTP directory |
| `closePort(port)` | Stop a virtual port |
| `ports()` | Listening virtual ports |
| `handleHttp(req)` | One-shot HTTP against the bridge |

**Preview wiring**

```ts
bn.on('server-ready', (port, url) => { /* iframe src = url */ });
bn.attachServiceWorkerBridge('/__bn_preview');
```

Returns an unsubscribe function.

---

## Snapshots, ZIP, workspace

| Method | Role |
|--------|------|
| `exportSnapshot()` | gzip of `/home` |
| `importSnapshot(bytes)` | Restore `/home` |
| `importZip(bytes, dest?)` | zip/tar.gz → VFS (default dest `/home/project`) |
| `extractTar(data, destDir)` | uncompressed tar (installer) |
| `clearWorkspace()` | Wipe `/home`, recreate `/home/project` |

`extractArchive` / `isZip` / `isGzip` are also exported as functions.

---

## Events — `bn.on` / `bn.off`

| Event | Payload |
|-------|---------|
| `server-ready` | `(port: number, url: string)` |
| `install-progress` | `{ phase, name, version?, message?, streamed? }` |
| `fs-change` | `{ type, path }` |
| `http-log` | `{ port, method, path, status }` |
| `error` | `Error` |

If `install-progress.streamed` is true, the same line already went to process stdout — do not print twice.

---

## Agent RPC — `bn.rpc(req)`

JSON-RPC 2.0 over the host (`handleAgentRpc`). Methods:

| `method` | `params` | Result |
|----------|----------|--------|
| `runtime` | — | `'wasm'` |
| `ports` | — | `number[]` |
| `fs.readFile` | `{ path }` | utf8 string |
| `fs.writeFile` | `{ path, contents }` | `true` |
| `fs.readdir` | `{ path }` | `string[]` |
| `fs.mkdir` | `{ path }` | `true` |
| `spawn` | `{ cmd, args, cwd }` or `[cmd, args, cwd]` | `{ pid }` |
| `install` | `{ packages, cwd }` | `true` |
| `killTree` | `{ pid }` | `boolean` |

Unknown method → JSON-RPC `-32601`.

---

## `WebContainer` shim

Same kernel. Names overlap StackBlitz; **behavior is not a drop-in**.

```ts
const wc = await WebContainer.boot();
await wc.mount({ /* FileSystemTree */ });
await wc.spawn('node', ['app.js']);
wc.instance.install(['lodash'], '/home/project'); // extra APIs
wc.teardown();
```

Surface on the shim: `boot`, `fs`, `runtime`, `worker`, `sabStdio`, `mount`, `spawn`, `on`, `teardown`, `instance`.

---

## Other exports

| Export | Role |
|--------|------|
| `resetKernelCache()` | Drop cached WASM module (tests) |
| `sabStdioAvailable()` / `SabStdioRing` | SAB stdio rings |
| `assertAllowedFetchUrl(url)` | npm egress allowlist |
| `detectProjectKind(bn, cwd)` | `'vite' \| 'next' \| 'static' \| 'node' \| …` |
| `resolveProjectRoot(bn, cwd)` | Nested app root |
| `HttpBridge` | Virtual HTTP (used internally; also exported) |

---

## Headless (Node)

```js
import { NodeBrowser } from '@foisal/nodebrowser';

const bn = await NodeBrowser.boot();
await bn.fs.writeFile('/tmp/hi.js', "console.log('agent-ok')");
const proc = await bn.spawn('node', ['/tmp/hi.js'], { cwd: '/' });
for await (const chunk of proc.output) process.stdout.write(chunk);
bn.teardown();
```

Repo example: `examples/headless.mjs`.

---

## `teardown()`

Detach Service Worker bridge, close HTTP ports, destroy the kernel handle. Call once when the tab or agent session ends.
