# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The published version is the `X.Y.Z` line in [`VERSION.md`](./VERSION.md).

## [Unreleased]

### Added

- Guest `crypto.createHmac` for sha1, sha256, sha384, and sha512, plus `timingSafeEqual` and `getHashes`
- Guest `fs.cpSync` / `fs.rmSync` (and the promises forms) and `stream.pipeline` / `stream.finished`
- Guest `process.stdin` on the QuickJS kernel reads bytes written to the process input and emits `data`
- Guest `readline.createInterface` emits `line` from that input, and `question` waits for the next line
- Guest `http.request` / `http.get` (and `https`) call a virtual server on localhost and deliver the status, headers, and body
- Guest `child_process.spawn` / `execFile` pass arguments after the script and the `env` option into the child
- Guest `fs.openSync` / `readSync` / `writeSync` / `closeSync` / `fstatSync`, plus `fs.promises.open`
- Guest `fs.truncateSync` / `ftruncateSync` / `appendFileSync`, plus `fs.promises.truncate` and `appendFile`
- Guest `fs.readFileSync` / `writeFileSync` / `appendFileSync` accept an open file descriptor and leave it open
- Guest `path.win32` resolves Windows paths (`join`, `dirname`, `basename`, `normalize`, `parse`, `relative`, `resolve`) separately from `path.posix`
- Guest `fs.renameSync` and `fs.promises.rename` move files and directories, and open descriptors follow the new path
- Guest `process.hrtime`, `process.hrtime.bigint`, and `process.uptime` use a monotonic clock
- Guest `process.chdir` changes the working directory, and relative `fs` paths resolve from `process.cwd()`
- Guest `fs.accessSync` and `fs.promises.access` honor `F_OK`, `R_OK`, `W_OK`, and `X_OK` against the file mode
- Guest `fs.realpathSync` follows symlinks, resolves `.` and `..`, and throws `ELOOP` on a cycle
- V8 guest runs on its own thread when the WASM kernel is on a Worker, with filesystem calls over a SharedArrayBuffer
- `async_hooks.AsyncLocalStorage` uses Node's own hooks on the V8 guest there, so `await` keeps the store; the embedded polyfill covers `.then`, timers, and `nextTick`. ESM `export *` / `export { } from` and the `import` exports condition resolve
- npm tarball cache in OPFS (browser) or the temp directory (Node); scoped installs hoist a nested package root such as `@types/ms`
- `WebContainer` compatibility layer for the public tutorial surface: workdir-relative filesystem, `spawn` streams (`output` / `input` / `exit` / `kill` / `resize`), `on` unsubscribe (`server-ready`, `port`, `error`, `preview-message`, `xdg-open`, `code`), `export` (`json` / `zip`), preview script injection, and `coep: 'none'` reduced mode. See [docs/MIGRATING.md](./docs/MIGRATING.md).
- `HostGuestEngine` so `boot({ guestEngine: 'v8' })` is an engine behind `spawn`, with QuickJS remaining the kernel default
- Process teardown stops stdio polls, closes port events, and releases spawn hooks so a later `boot()` is not stuck on a live timer
- Host power tools: content search, replace, glob, diff, watch, `exec`, project inspect, workspace install, zip export, public GitHub import
- npm install reads exact versions from `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`; `.npmrc` registry tokens; optional peer install
- Browser: C++/WASM kernel on a **Worker** (`bn.worker`) so long `node` does not freeze the tab; Node/tests stay same-thread
- **Phase 13b:** deleted `js-runtime.ts`; `boot()` is WASM-only; PR CI builds C++ → WASM (Emscripten) then runs conformance
- Installed **tsc** / **vite** CLIs run in QuickJS when the module graph fits; Vite still uses host esbuild-wasm as the fast path
- `@xterm/xterm` in the demo; SAB/Atomics stdio rings (Worker ↔ UI); Playwright Chromium bake-off (`e2e/`, WC placeholder)
- Automated release on `main`: npm Trusted Publisher (OIDC), GitHub Packages, GitHub Release
- Releases publish the version in `VERSION.md` only when it is higher than the latest release
- GitHub Pages demo deploy (self-contained `demo/dist`, base path `/NodeBrowser/`)
- Release/Pages CI builds **C++ → WASM** with Emscripten before npm publish / demo deploy
- **Phases 13–20:** WASM spawn `env` + `read_bytes`; streams/util/timers; zlib + crypto hashes; symlink/`fs.watch`/`fs-change`; `child_process`; ESM + `exports`; OPFS `persist` + snapshot export/import; `net`/`https`; WASM HTTP keep-alive via retained QuickJS handlers
- **C++/QuickJS guest modules:** `kernel/embed/guest_modules.js` (stream/util/zlib/crypto/child_process/http/https/net/ESM) + VFS symlink/`readlink`/`lstat` ABI; host `kernel.ts` wires those ABI entry points

### Fixed

- C++/WASM builds no longer pick up QuickJS's `version` file as the C++ `<version>` header

### Changed

- Public package renamed to **`@foisal/nodebrowser`**
- **Primary runtime is C++/WASM** — `boot()` throws if WASM is missing; no JS guest
- Mount/npm extract keep binary files as `Uint8Array` end-to-end

## [1.0.0] — TBD

First automated npm release of `@foisal/nodebrowser`.

## [0.1.0] — 2026-08-11

### Added

- C++ kernel: VFS, processes, C ABI
- QuickJS node runner (native) + JS fallback runtime
- Host API: `boot`, `mount`, `spawn`, `install`, HTTP bridge, esbuild-wasm `bundle`
- Demo playground with COOP/COEP service worker preview
- npm install into VFS (deps + cache)
- Node subset: `fs` / `path` / `http` / `crypto` / `buffer` / `module.createRequire` / stubs
- MIT license and project roadmap (`PLAN.md`)
- **Phase 13:** WASM/JS host parity — `fs.rename`, binary `readFile`, spawn `env`, `boot({ useWasm })`, conformance tests
- In-browser VFS file manager; Vite/Next host templates

[Unreleased]: https://github.com/foisalislambd/NodeBrowser/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/foisalislambd/NodeBrowser/releases/tag/v1.0.0
[0.1.0]: https://github.com/foisalislambd/NodeBrowser/releases/tag/v0.1.0
