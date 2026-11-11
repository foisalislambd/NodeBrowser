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

import { WebContainer, configureAPIKey, auth } from '@foisal/nodebrowser/compat';
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
| `guestEngine` | `'quickjs' \| 'v8'` | `'quickjs'` | `v8` runs `node` on the host engine when kernel calls are synchronous |
| `sharedArrayBuffer` | `boolean` | `true` | `false` keeps the poll stdio transport |

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

## Power tools

These run on the host against the kernel VFS. They skip `node_modules`, `.git`, `dist`, and `.next` unless noted.

| Method | Role |
|--------|------|
| `glob(pattern, cwd?)` | `src/**/*.ts` style match |
| `search(query, opts?)` | Content search → `{ path, line, text }[]` |
| `replace(query, replacement, opts?)` | Replace across files |
| `diff(pathA, pathB)` | Unified line diff |
| `digest(dir?)` | Text fingerprint `hex:count` |
| `exportZip(dir?)` | Stored zip of a project directory |
| `importRepository(spec, opts?)` | Public `owner/repo` zipball from GitHub into the VFS |
| `inspect(cwd?)` | Scripts, dependencies, workspaces, lockfile kind |
| `workspaces(cwd?)` | Workspace directories |
| `installWorkspaces(cwd?, opts?)` | `npm install` at the root and each workspace |
| `lockPins(cwd?)` | Exact versions from `package-lock.json`, else `yarn.lock`, else `pnpm-lock.yaml` |
| `readEnv(cwd?)` | `.env`, `.env.local`, `.env.development` |
| `exec(cmd, args?, opts?)` | Spawn and collect `{ pid, code, output }` |
| `watch(prefix, fn)` | `fs-change` under a path; returns unsubscribe |
| `configureRegistry` / `loadNpmrc` / `resetRegistry` | Private registry + token (memory only, sent only to that host) |
| `capabilities()` | Runtime flags and feature names |

`spawn` options also accept `timeoutMs` and `loadEnv` (explicit `env` wins over `.env`). `install(..., { peers: true })` installs `peerDependencies`. Empty `install([])` pins ranges to the lockfile version when one is present. Yarn and pnpm are not executed; their lockfiles only supply versions, and tarballs still come from the npm registry.

GitHub fetch is allowlisted only for `importRepository` (`codeload.github.com`). It is not added to the default npm egress list.

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
| `port` | `(port: number, type: 'open' \| 'close', url: string)` |
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
| `capabilities` | — | runtime + feature list |
| `fs.glob` | `{ pattern, cwd }` | `string[]` |
| `fs.search` | `{ query, cwd, glob?, max? }` | search hits |
| `fs.replace` | `{ query, replacement, cwd, glob? }` | `{ files, replacements }` |
| `exec` | `{ cmd, args, cwd, timeoutMs? }` | `{ pid, code, output }` |
| `inspect` | `{ cwd }` | project info |
| `lockPins` | `{ cwd }` | `{ [name]: version }` |
| `readEnv` | `{ cwd }` | env object |

Unknown method → JSON-RPC `-32601`.

---

## `WebContainer`

Compatibility layer for the public WebContainer tutorial surface. Same kernel. Migration notes and the remaining gaps: [MIGRATING.md](./MIGRATING.md).

```ts
import { WebContainer } from '@foisal/nodebrowser/compat';

const wc = await WebContainer.boot();
await wc.mount({
  'index.js': { file: { contents: "console.log('ok')\n" } },
  'package.json': { file: { contents: '{"scripts":{"start":"node index.js"}}' } },
});
const proc = await wc.spawn('npm', ['run', 'start']);
proc.output.pipeTo(new WritableStream({ write(chunk) { console.log(chunk); } }));
await proc.exit;
wc.teardown();
```

Only one `WebContainer` is booted at a time. `teardown()` allows the next `boot()`.

| Member | Behavior |
|--------|----------|
| `boot({ coep?, workdirName?, forwardPreviewErrors? })` | `coep: 'none'` skips SharedArrayBuffer stdio. `workdirName` defaults to `project`. |
| `workdir` | `/home/<workdirName>`. Default `/home/project`. |
| `path` | Default `PATH` (`<workdir>/node_modules/.bin`) applied when `spawn` env omits `PATH`. |
| `mount(tree \| zip, { mountPoint? })` | Relative `mountPoint` is under `workdir`. A string mount point is still accepted. Zip bytes are archives from `export`, not a proprietary snapshot. Symlinks use `{ file: { symlink } }`. |
| `spawn(cmd, args?, { cwd, env, output, terminal })` | `cwd` defaults to `workdir`. `output: false` yields an empty stream and still drains the process. `env` values are stringified. |
| process | `output` (`ReadableStream`), `input` (`WritableStream`), `exit`, `kill()`, `resize()`. `write()` is an extra. |
| `fs.readFile` | No encoding → `Uint8Array`. `'utf8'` / `'utf-8'` → string. Relative paths use `workdir`. |
| `fs.writeFile` / `mkdir` / `readdir` / `rm` / `rename` / `watch` | `readdir({ withFileTypes: true })` returns `{ name, isFile, isDirectory }`. `rm({ force: true })` ignores missing paths. `mkdir({ recursive: true })` resolves to the first created directory. `watch` returns `{ close() }`. |
| `on` | Returns an unsubscribe function. Events: `server-ready`, `port` (`open` \| `close`), `error` (`{ message }`), `preview-message`, `xdg-open`, `code`. |
| `export(path, { format, includes, excludes })` | `json` (default) is a `FileSystemTree`. `zip` and `binary` are a stored zip this runtime can `mount` again. |
| `setPreviewScript(src, options?)` | Injects `<script src>` into HTML served by the host preview. |
| `teardown()` | Kills host-side waits, closes ports, destroys the kernel. Further calls throw. |
| `instance` | The `NodeBrowser` (install, preview, zip, RPC, …). |

`configureAPIKey` and `auth` are exported from `@foisal/nodebrowser/compat`. They do not contact StackBlitz; npm auth stays on `.npmrc` / `configureRegistry`.

Guest `process.stdin` does not yet yield bytes written to `input`. The stream is accepted and stored on the kernel pipe.

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

Detach Service Worker bridge, close HTTP ports (`port` / `close`), stop stdio polls, drop listeners owned by this instance, and destroy the kernel handle. A process that is still running has `exit` resolve to `137`. Calling `teardown()` again does nothing. `fs` and `spawn` after teardown throw. Call it once when the tab or agent session ends.
