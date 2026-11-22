# Node module coverage

Target: Node 20 compatible surface for tooling (Vite first, then Next).

**Canonical guest implementation:** C++/QuickJS only (`kernel/embed/guest_modules.js` → WASM). Host TypeScript is not a Node runtime. Status below is **embed/WASM**.

| Module | Status | Notes |
|--------|--------|-------|
| `fs` / `fs/promises` | ok (subset) | + symlink/lstat/watch/**chmod/utimes/cp/rm/rename/access mode/realpath/open fd/truncate/appendFile**/`readFile`+`writeFile` on an fd, **encoding (`hex`/`base64`/`utf8`/`buffer`)**, **`readdir` `withFileTypes` (`Dirent`)**, **callback `readFile`/`writeFile`/`readdir`/`stat`**, mode+mtime, binary buffer I/O, host `rename` |
| `path` | partial | **posix and win32** (`join`, `dirname`, **basename with suffix**, **extname from the last segment**, **`normalize`/`resolve` collapse `.` and `..`**, `parse`, `format`, `relative`) |
| `process` | partial | cwd, **chdir**, argv, **env from spawn**, exit, nextTick, **stdin `data` and `end`**, **hrtime / uptime** |
| `buffer` | ok (subset) | alloc/from/concat, utf8 through U+10FFFF, base64/base64url/latin1/hex, byteLength, equals, compare, copy, fill, indexOf, read/write UInt/Int 8/16/32 BE and LE, **toJSON** |
| `events` | ok | `on` / `once` / `prependListener`, `off` removes a one-shot by the original function, `eventNames`, and `events.once` |
| `stream` | ok (subset) | Readable/Writable/Duplex/Transform + `.pipe()`, `pipeline`, `finished`, `stream/promises` |
| `http` / `https` | ok (subset) | createServer + listen → HttpBridge; `request`/`get` to virtual localhost; **`STATUS_CODES`, `setHeader`/`getHeader`/`removeHeader`, `statusCode` and `statusMessage`**; chunked write/end; upgrade stub |
| `connect` | stub | middleware stack → `http.createServer` |
| `ws` | stub | Server/handleUpgrade no-op sockets |
| `corepack` | stub | npm-only; yarn/pnpm not executed |
| `net` | ok (subset) | Server/Socket on virtual ports via HttpBridge |
| `child_process` | ok (subset) | spawn/execFile pass argv after the script and `env`; `kill` = kill tree; max 32 procs |
| `module` / `require` | ok | CJS + **createRequire** + `exports` field + ESM rewrite |
| `url` | ok (subset) | **`parse` (auth, port, query, hash, IPv6) and `format`** + `fileURLToPath` / `pathToFileURL` (percent-encoding, `localhost`, scheme and host errors) |
| `util` | ok (subset) | promisify/callbackify/**format** (placeholders plus leftover args)/**inspect**/**isDeepStrictEqual**/inherits/deprecate/types |
| `os` | ok (subset) | platform linux, tmpdir, cpus, homedir, **Linux `constants.signals` / `errno` / `priority`** |
| `crypto` | ok (subset) | randomFillSync, randomBytes, **randomInt**, **randomUUID**, **pbkdf2Sync**, createHash / createHmac (**sha1/sha256/sha384/sha512**), **createCipheriv/createDecipheriv (aes-128/192/256-cbc)**, timingSafeEqual |
| `zlib` | ok (subset) | gzip/gunzip/deflate/inflate sync (+ streams) |
| `string_decoder` | ok (subset) | UTF-8 `write` keeps an incomplete character for the next chunk; `end` emits U+FFFD |
| `timers` / `timers/promises` | ok (subset) | |
| `perf_hooks` | ok (subset) | performance.now + no-op PerformanceObserver |
| `async_hooks` | ok (subset) | On Node's V8 guest this is the host's `async_hooks`, so `await` keeps the store. QuickJS and the browser use the embedded polyfill: `.then`, timers, and `nextTick` keep it; `await` does not |
| `diagnostics_channel` | stub | channel subscribe/publish |
| `worker_threads` | ok (subset) | Cooperative `Worker` (same thread); not OS threads / SAB |
| `next/cache` / `next/headers` | stub | revalidate/cookies no-ops when package not installed |
| `vm` | ok (subset) | `runInThisContext`; `runInNewContext` = extra QuickJS `JSContext` |
| `cluster` | stub | `fork` throws |
| `dns` / `dgram` | stub | lookup → 127.0.0.1 |
| `inspector` / `v8` / `wasi` | stub | |
| `assert` | ok (subset) | ok/equal/strictEqual, **deepEqual/deepStrictEqual** (objects, buffers, dates, regex), `assert.strict`, throws |
| `querystring` | ok (subset) | parse/stringify + arrays |
| `constants` / `punycode` / `sys` | partial | `constants.os` is the Linux signal and errno table; `constants.fs` is `fs.constants`; sys → util |
| `tty` | ok (stub) | `isatty` → false; ReadStream/WriteStream |
| `readline` | ok (subset) | `createInterface` splits `input` into `line` events; `question` waits for the next line |

## Vite checklist

- [x] `esbuild-wasm` transform path (`NodeBrowser.bundle` / `viteDev`)
- [x] Installed `tsc` CLI in QuickJS (`spawn('tsc')` / `bn.tsc`)
- [x] Installed `vite` CLI tried in QuickJS; native esbuild → host subset
- [x] `fs.promises` + Buffer
- [x] `http` upgrade stub; in-tab HMR = reload poll (`__hmr_gen`)
- [x] `crypto.randomFillSync`
- [x] `perf_hooks`
- [x] `fs.watch` / host `fs-change`

## Next.js checklist

- [x] broader `fs` + `module.createRequire`
- [x] `async_hooks` AsyncLocalStorage (Promise, timers, nextTick) / `diagnostics_channel` stubs
- [x] `next/cache` / `next/headers` stubs
- [x] `app/api/*/route.js` static JSON subset
- [x] OPFS persist (`boot({ persist: true })`) for `/home`
