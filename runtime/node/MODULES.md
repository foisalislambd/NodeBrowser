# Node module coverage

Target: Node 20 compatible surface for tooling (Vite first, then Next).

| Module | Status | Notes |
|--------|--------|-------|
| `fs` / `fs/promises` | ok (subset) | sync + promises read/write/mkdir/readdir/unlink/stat |
| `path` | partial | posix only |
| `process` | partial | cwd, argv, env, exit, **nextTick** |
| `buffer` | ok (subset) | alloc/from/concat/utf8/base64/hex |
| `events` | ok | EventEmitter basics |
| `stream` | stub | EE subclasses |
| `http` | ok (subset) | createServer + listen → HttpBridge / keep-alive |
| `https` | todo | |
| `net` | todo | map to virtual ports |
| `child_process` | todo | kernel spawn |
| `module` / `require` | ok | CJS; ESM next |
| `url` | stub | |
| `util` | stub | |
| `os` | stub | |
| `crypto` | ok (subset) | randomFillSync, randomBytes, createHash(sha256) |
| `perf_hooks` | ok (subset) | performance.now + no-op PerformanceObserver |
| `worker_threads` | todo | |
| `vm` | todo | QuickJS realms |
| `assert` | stub | |
| `querystring` | stub | |
| `zlib` | todo | DecompressionStream |
| `tty` | todo | |
| `readline` | todo | |

## Vite checklist

- [x] `esbuild-wasm` transform path (`BrowserNode.bundle`)
- [x] `fs.promises` + Buffer
- [ ] `http` upgrade / HMR websocket via SW
- [x] `crypto.randomFillSync`
- [x] `perf_hooks`

## Next.js checklist

- [ ] broader `fs` + `module.createRequire`
- [ ] `async_hooks` / `diagnostics_channel` stubs
- [ ] edge vs node runtime split
- [ ] large dependency install performance (OPFS cache)
