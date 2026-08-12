# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
with a release roll of patch/minor at **9** (`1.0.9` → `1.1.0`).

## [Unreleased]

### Added

- Automated release on `main`: npm Trusted Publisher (OIDC), GitHub Packages, GitHub Release
- Version scheme `1.0.0` → `1.0.1` → … → `1.0.9` → `1.1.0`
- GitHub Pages demo deploy (self-contained `demo/dist`, base path `/NodeBrowser/`)
- Release/Pages CI builds **C++ → WASM** with Emscripten before npm publish / demo deploy
- **Phases 13–20:** WASM spawn `env` + `read_bytes`; streams/util/timers; zlib + crypto hashes; symlink/`fs.watch`/`fs-change`; `child_process`; ESM + `exports`; OPFS `persist` + snapshot export/import; `net`/`https`; WASM HTTP keep-alive via retained QuickJS handlers
- **C++/QuickJS guest modules:** `kernel/embed/guest_modules.js` (stream/util/zlib/crypto/child_process/http/https/net/ESM) + VFS symlink/`readlink`/`lstat` ABI; host `kernel.ts` wires those ABI entry points

### Changed

- Public package renamed to **`@foisal/nodebrowser`**
- **Primary runtime is C++/WASM** — `boot({ useWasm: true })` is the default; JS is fallback only
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
