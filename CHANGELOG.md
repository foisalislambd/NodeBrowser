# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Phase 13:** WASM/JS host parity — `fs.rename`, binary `readFile(..., 'buffer')`, spawn `env` → `process.env` (JS), `boot({ useWasm: 'auto' })`, `bn.runtime`, conformance tests (`npm run test:api`)
- Public npm package name set to **`browsernode-runtime`** (`browsernode` is taken on npm); monorepo root is `browsernode-monorepo`
- Master future roadmap in `PLAN.md` (phases 13–42): WASM parity, OPFS, ESM, npm 2.0, Vite/Next in-tab, productization
- Public `ROADMAP.md` summary aligned with PLAN
- In-browser VFS file manager in the demo (browse, save, new file/dir, delete)
- Host `bn.fs.exists`, `bn.fs.stat`, `bn.fs.rm({ recursive })`
- Project-cwd npm install + save-then-run UX in the demo
- Real `create-vite` / `create-next-app` templates under `demo/templates/`
- Responsive demo shell with mobile panel navigation
- Docs: `docs/PUBLISHING.md` for npm naming & publish steps

### Changed

- Default browser boot uses JS runtime + HttpBridge (WASM optional via `useWasm`)

## [0.1.0] — 2026-08-11

### Added

- C++ kernel: VFS, processes, C ABI
- QuickJS node runner (native) + JS fallback runtime
- `browsernode-runtime` package: `boot`, `mount`, `spawn`, `install`, HTTP bridge, esbuild-wasm `bundle`
- Demo playground with COOP/COEP service worker preview
- npm install into VFS (deps + cache)
- Node subset: `fs` / `path` / `http` / `crypto` / `buffer` / `module.createRequire` / stubs
- MIT license and project roadmap (`PLAN.md`)

[Unreleased]: https://github.com/YOUR_ORG/browsernode/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/YOUR_ORG/browsernode/releases/tag/v0.1.0
