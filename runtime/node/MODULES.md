# Node module coverage

Target: Node 20 compatible surface for tooling (Vite first, then Next).

**Canonical guest implementation:** C++/QuickJS only (`kernel/embed/guest_modules.js` → WASM). Host TypeScript is not a Node runtime. The old `js-runtime.ts` fallback is frozen and scheduled for deletion (PLAN Phase 13b). Status below is **embed/WASM**, not JS.

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
| `url` | stub | |
| `util` | ok (subset) | promisify/callbackify/format/inherits |
| `os` | stub | |
| `crypto` | ok (subset) | randomFillSync, randomBytes, createHash(**sha1/sha256/sha384/sha512**) |
| `zlib` | ok (subset) | gzip/gunzip/deflate/inflate sync (+ streams) |
| `string_decoder` | ok (subset) | |
| `timers` / `timers/promises` | ok (subset) | |
| `perf_hooks` | ok (subset) | performance.now + no-op PerformanceObserver |
| `async_hooks` | stub | AsyncLocalStorage + createHook no-op |
| `diagnostics_channel` | stub | channel subscribe/publish |
| `worker_threads` | stub | `isMainThread`; `Worker` throws until SAB/Web Worker bridge |
| `vm` | stub | `runInThisContext` / `runInNewContext` (same realm) |
| `cluster` | stub | `fork` throws |
| `dns` / `dgram` | stub | lookup → 127.0.0.1 |
| `inspector` / `v8` / `wasi` | stub | |
| `assert` | stub | |
| `querystring` | stub | |
| `tty` | ok (stub) | `isatty` → false; ReadStream/WriteStream |
| `readline` | ok (stub) | createInterface MVP |

## Vite checklist

- [x] `esbuild-wasm` transform path (`NodeBrowser.bundle` / `viteDev`)
- [x] `fs.promises` + Buffer
- [x] `http` upgrade stub; in-tab HMR = reload poll (`__hmr_gen`)
- [x] `crypto.randomFillSync`
- [x] `perf_hooks`
- [x] `fs.watch` / host `fs-change`

## Next.js checklist

- [x] broader `fs` + `module.createRequire`
- [x] `async_hooks` / `diagnostics_channel` stubs
- [ ] edge vs node runtime split
- [x] OPFS persist (`boot({ persist: true })`) for `/home`
