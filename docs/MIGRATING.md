# Migrating from WebContainers

`@foisal/nodebrowser/compat` implements the **public** WebContainer tutorial surface on the NodeBrowser kernel. It is not a copy of the proprietary runtime. Guest JavaScript is QuickJS in WASM (or the optional host engine). Native addons, raw TCP, and bit-identical Node are still out of scope: [LIMITS.md](./LIMITS.md).

```ts
import { WebContainer } from '@foisal/nodebrowser/compat';

const wc = await WebContainer.boot({ coep: 'require-corp' });
await wc.mount({
  'index.js': { file: { contents: "console.log('ok')\n" } },
  'package.json': {
    file: { contents: JSON.stringify({ scripts: { start: 'node index.js' } }) },
  },
});

const install = await wc.spawn('npm', ['install']);
install.output.pipeTo(new WritableStream({ write(data) { console.log(data); } }));
if ((await install.exit) !== 0) throw new Error('install failed');

wc.on('server-ready', (port, url) => {
  console.log(port, url);
});
const app = await wc.spawn('npm', ['run', 'start']);
await app.exit;
wc.teardown();
```

## What lines up

| Public call | Here |
|-------------|----------------|
| `WebContainer.boot` | One live instance. Second `boot()` throws until `teardown()`. |
| `workdir` / `workdirName` | Default `/home/project`. The name is the folder under `/home`, not a random id. |
| `mount(FileSystemTree)` | Same `file` / `directory` tree, plus `{ file: { symlink } }`. |
| `mount(Uint8Array)` | A zip from `export({ format: 'zip' \| 'binary' })`. |
| `spawn` | `output`, `input`, `exit`, `kill()`, `resize()`. `output: false` stays empty and still drains the process. `cwd` defaults to `workdir`. |
| `fs.readFile` / `writeFile` / `readdir` / `mkdir` / `rm` / `rename` / `watch` | Relative paths resolve under `workdir`. Absolute paths address the VFS. `readFile` without an encoding returns `Uint8Array`. `watch(...).close()`. `rm({ force })`. `readdir({ withFileTypes: true })`. |
| `on('server-ready')` / `on('port')` / `on('error')` | Unsubscribe function. `error` is `{ message }`. `port` is `open` or `close`. |
| `on('xdg-open')` / `on('code')` | Those commands emit the event and exit 0. |
| `export(path, { format: 'json' })` | `FileSystemTree`. `includes` re-adds files matched by `excludes`. |
| `export` `zip` or `binary` | Stored zip. `binary` is **not** the proprietary snapshot format; `mount` reads this zip. |
| `setPreviewScript` | `<script src>` on HTML from the host preview (`serveStatic` and HTML responses on the bridge). |
| `forwardPreviewErrors` | Adds a small reporter that `postMessage`s `nodebrowser-preview` to the parent. |
| `teardown` | Stops polls, closes ports, destroys the kernel. `exit` of a live process resolves with `137`. |
| `coep: 'none'` | Reduced mode: kernel boots, stdio is polled, SharedArrayBuffer rings stay off. Use this when the page cannot send COOP/COEP. |
| `configureAPIKey` / `auth` | Names exist so imports compile. Nothing is sent to StackBlitz. Registry tokens stay in `.npmrc` / `configureRegistry`. |

`instance` is the `NodeBrowser` object (`install`, `viteDev`, `importZip`, `rpc`, …). Those methods are not part of `@webcontainer/api`.

`boot({ guestEngine: 'v8' })` runs `node` (and simple `sh -c`) on the host JS engine when kernel calls are synchronous. The default remains QuickJS inside the kernel. See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Follow-up

- Guest `process.stdin` does not yet read the `input` stream. Writes are accepted on the kernel pipe.
- `resize()` is stored for the host. The guest does not receive SIGWINCH.
- `export({ format: 'binary' })` will not round-trip through another product's snapshot decoder.
- Preview messages from a cross-origin iframe still need the page to forward `postMessage`. The host listens on `window` when it exists.
- One global hook owner: two overlapping `NodeBrowser` instances can steal `server-ready` from each other. `WebContainer` allows only one instance.
- The `v8` engine runs on the boot thread today. The `HostGuestEngine` interface is the seam for a Worker later.
- QuickJS is still a subset. Heavy ESM graphs, native addons, and full Vite 8 / `next start` are unchanged — [LIMITS.md](./LIMITS.md).
