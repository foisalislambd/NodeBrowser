# Node module coverage

Target: Node 20 compatible surface for tooling (Vite first, then Next).

| Module | Status | Notes |
|--------|--------|-------|
| `fs` / `fs/promises` | partial | sync MVP; promises next |
| `path` | partial | posix only |
| `process` | partial | cwd, argv, env, exit |
| `buffer` | stub | string-backed |
| `events` | ok | EventEmitter basics |
| `stream` | stub | EE subclasses |
| `http` | partial | createServer + listen → host preview |
| `https` | todo | |
| `net` | todo | map to virtual ports |
| `child_process` | todo | kernel spawn |
| `module` / `require` | ok | CJS; ESM next |
| `url` | stub | |
| `util` | stub | |
| `os` | stub | |
| `crypto` | todo | WebCrypto bridge |
| `worker_threads` | todo | |
| `vm` | todo | QuickJS realms |
| `assert` | stub | |
| `querystring` | stub | |
| `zlib` | todo | DecompressionStream |
| `tty` | todo | |
| `readline` | todo | |

## Vite checklist

- [ ] `esbuild-wasm` or oxc wasm transform path
- [ ] `fs.promises` + watch stubs
- [ ] `http` upgrade / HMR websocket via SW
- [ ] `crypto.randomFillSync`
- [ ] `perf_hooks`

## Next.js checklist

- [ ] broader `fs` + `module.createRequire`
- [ ] `async_hooks` / `diagnostics_channel` stubs
- [ ] edge vs node runtime split
- [ ] large dependency install performance (OPFS cache)
