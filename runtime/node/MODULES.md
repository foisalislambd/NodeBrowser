# Node module coverage

Target: Node 20 compatible surface for tooling (Vite first, then Next).

**Canonical guest implementation:** C++/QuickJS (`kernel/embed/guest_modules.js` → WASM). JS fallback mirrors for no-WASM boots only.

| Module | Status | Notes |
|--------|--------|-------|
| `fs` / `fs/promises` | ok (subset) | + symlink/lstat/watch, binary buffer I/O, host `rename` |
| `path` | partial | posix only |
| `process` | partial | cwd, argv, **env from spawn**, exit, nextTick |
| `buffer` | ok (subset) | alloc/from/concat/utf8/base64/hex + index Proxy |
| `events` | ok | EventEmitter basics |
| `stream` | ok (subset) | Readable/Writable/Duplex/Transform + `.pipe()` |
| `http` / `https` | ok (subset) | createServer + listen → HttpBridge; chunked write/end; upgrade stub |
| `net` | ok (subset) | Server/Socket on virtual ports via HttpBridge |
| `child_process` | ok (subset) | spawn/execFile for `node` + shell stubs; max 32 procs |
| `module` / `require` | ok | CJS + **createRequire** + `exports` field + ESM rewrite |
| `url` | stub | |
| `util` | ok (subset) | promisify/callbackify/format/inherits |
| `os` | stub | |
| `crypto` | ok (subset) | randomFillSync, randomBytes, createHash(**sha1/sha256** only) |
| `zlib` | ok (subset) | gzip/gunzip/deflate/inflate sync (+ streams) |
| `string_decoder` | ok (subset) | |
| `timers` / `timers/promises` | ok (subset) | |
| `perf_hooks` | ok (subset) | performance.now + no-op PerformanceObserver |
| `async_hooks` | stub | AsyncLocalStorage + createHook no-op |
| `diagnostics_channel` | stub | channel subscribe/publish |
| `worker_threads` | todo | |
| `vm` | todo | QuickJS realms |
| `assert` | stub | |
| `querystring` | stub | |
| `tty` | todo | |
| `readline` | todo | |

## Vite checklist

- [x] `esbuild-wasm` transform path (`NodeBrowser.bundle`)
- [x] `fs.promises` + Buffer
- [ ] `http` upgrade / HMR websocket via SW
- [x] `crypto.randomFillSync`
- [x] `perf_hooks`
- [x] `fs.watch` / host `fs-change`

## Next.js checklist

- [x] broader `fs` + `module.createRequire`
- [x] `async_hooks` / `diagnostics_channel` stubs
- [ ] edge vs node runtime split
- [x] OPFS persist (`boot({ persist: true })`) for `/home`
