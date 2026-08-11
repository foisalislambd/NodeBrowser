# Node module coverage

Target: Node 20 compatible surface for tooling (Vite first, then Next).

| Module | Status | Notes |
|--------|--------|-------|
| `fs` / `fs/promises` | ok (subset) | + constants, accessSync, realpathSync, copyFileSync; host `rename` + binary buffer I/O |
| `path` | partial | posix only |
| `process` | partial | cwd, argv, **env from spawn**, exit, nextTick |
| `buffer` | ok (subset) | alloc/from/concat/utf8/base64/hex + index Proxy |
| `events` | ok | EventEmitter basics |
| `stream` | stub | EE subclasses |
| `http` | ok (subset) | createServer + listen → HttpBridge / keep-alive |
| `https` | todo | |
| `net` | todo | map to virtual ports |
| `child_process` | todo | kernel spawn |
| `module` / `require` | ok | CJS + **createRequire** |
| `url` | stub | |
| `util` | stub | |
| `os` | stub | |
| `crypto` | ok (subset) | randomFillSync, randomBytes, createHash(sha256) |
| `perf_hooks` | ok (subset) | performance.now + no-op PerformanceObserver |
| `async_hooks` | stub | AsyncLocalStorage + createHook no-op |
| `diagnostics_channel` | stub | channel subscribe/publish |
| `worker_threads` | todo | |
| `vm` | todo | QuickJS realms |
| `assert` | stub | |
| `querystring` | stub | |
| `zlib` | todo | DecompressionStream |
| `tty` | todo | |
| `readline` | todo | |

## Vite checklist

- [x] `esbuild-wasm` transform path (`NodeBrowser.bundle`)
- [x] `fs.promises` + Buffer
- [ ] `http` upgrade / HMR websocket via SW
- [x] `crypto.randomFillSync`
- [x] `perf_hooks`

## Next.js checklist

- [x] broader `fs` + `module.createRequire`
- [x] `async_hooks` / `diagnostics_channel` stubs
- [ ] edge vs node runtime split
- [ ] large dependency install performance (OPFS cache)
