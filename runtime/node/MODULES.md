# Node module coverage

Target: Node 20 compatible surface for tooling (Vite first, then Next).

**Canonical guest implementation:** C++/QuickJS only (`kernel/embed/guest_modules.js` → WASM). Host TypeScript is not a Node runtime. Status below is **embed/WASM**.

| Module | Status | Notes |
|--------|--------|-------|
| `fs` / `fs/promises` | ok (subset) | + symlink/lstat/watch/**chmod/utimes**/mode+mtime, binary buffer I/O, host `rename` |
| `path` | partial | posix only |
| `process` | partial | cwd, argv, **env from spawn**, exit, nextTick |
| `buffer` | ok (subset) | alloc/from/concat/utf8/base64/hex + index Proxy |
| `events` | ok | EventEmitter basics |
| `stream` | ok (subset) | Readable/Writable/Duplex/Transform + `.pipe()` |
| `http` / `https` | ok (subset) | createServer + listen → HttpBridge; chunked write/end; upgrade stub; HMR reload poll |
| `connect` | stub | middleware stack → `http.createServer` |
| `ws` | stub | Server/handleUpgrade no-op sockets |
| `corepack` | stub | npm-only; yarn/pnpm not executed |
| `net` | ok (subset) | Server/Socket on virtual ports via HttpBridge |
| `child_process` | ok (subset) | spawn/execFile; `parent_pid`; `kill` = kill tree; max 32 procs |
| `module` / `require` | ok | CJS + **createRequire** + `exports` field + ESM rewrite |
| `url` | ok (subset) | parse + `fileURLToPath` / `pathToFileURL` |
| `util` | ok (subset) | promisify/callbackify/format/inherits/deprecate/types |
| `os` | ok (subset) | platform linux, tmpdir, cpus, homedir |
| `crypto` | ok (subset) | randomFillSync, randomBytes, createHash(**sha1/sha256/sha384/sha512**) |
| `zlib` | ok (subset) | gzip/gunzip/deflate/inflate sync (+ streams) |
| `string_decoder` | ok (subset) | |
| `timers` / `timers/promises` | ok (subset) | |
| `perf_hooks` | ok (subset) | performance.now + no-op PerformanceObserver |
| `async_hooks` | stub | AsyncLocalStorage + createHook no-op |
| `diagnostics_channel` | stub | channel subscribe/publish |
| `worker_threads` | ok (subset) | Cooperative `Worker` (same thread); not OS threads / SAB |
| `next/cache` / `next/headers` | stub | revalidate/cookies no-ops when package not installed |
| `vm` | ok (subset) | `runInThisContext`; `runInNewContext` = extra QuickJS `JSContext` |
| `cluster` | stub | `fork` throws |
| `dns` / `dgram` | stub | lookup → 127.0.0.1 |
| `inspector` / `v8` / `wasi` | stub | |
| `assert` | ok (subset) | ok/equal/strictEqual/deepEqual/throws |
| `querystring` | ok (subset) | parse/stringify + arrays |
| `constants` / `punycode` / `sys` | stub | sys → util |
| `tty` | ok (stub) | `isatty` → false; ReadStream/WriteStream |
| `readline` | ok (stub) | createInterface MVP |

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
- [x] `async_hooks` / `diagnostics_channel` stubs
- [x] `next/cache` / `next/headers` stubs
- [x] `app/api/*/route.js` static JSON subset
- [x] OPFS persist (`boot({ persist: true })`) for `/home`
