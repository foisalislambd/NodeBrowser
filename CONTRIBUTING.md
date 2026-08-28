# Contributing to NodeBrowser

Thanks for helping build an in-browser Node runtime. This guide keeps contributions consistent and reviewable.

## Code of Conduct

Participation is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to contribute

- Bug reports and reproducible demos
- Docs / roadmap clarifications
- Node API polyfills and tests
- Demo UX (file manager, preview, a11y)
- Kernel / WASM improvements

## Development setup

**Requirements:** Node.js ≥ 20, npm. For native/WASM builds: CMake, Ninja, a C++ toolchain; Emscripten for WASM.

```bash
git clone --recurse-submodules <repo-url>
cd NodeBrowser
npm install
npm run build:api
npm run build:demo
npm run dev
```

Native tests:

```bash
npm run build:native
npm test
```

See [`README.md`](./README.md) and [`scripts/setup-toolchain.sh`](./scripts/setup-toolchain.sh) for full toolchain setup.

## Branch & PR workflow

1. Open an issue for non-trivial work (or claim an existing one).
2. Create a branch: `feat/…`, `fix/…`, or `docs/…`.
3. Keep PRs focused — one concern per PR when possible.
4. Fill out the PR template; link related issues.
5. Ensure CI passes (WASM boot + API conformance, demo build, native tests when kernel touched).

### Commit messages

Prefer short, imperative subjects:

- `fix: hoist npm deps when package.json missing`
- `feat: add bn.fs.stat for file manager`
- `docs: document Phase 12 file manager`

## Coding guidelines

- Match existing style in the file you touch; don’t drive-by reformat unrelated code.
- TypeScript for `packages/api`; keep public API intentional and typed.
- C++ kernel changes should include or update `kernel/tests` when behavior changes.
- Demo: vanilla JS/CSS; keep mobile pane switching working.
- Do not commit secrets, large binaries, or `node_modules`.
- Do not expand scope into full Vite/Next-in-WASM unless agreed in an issue/`ROADMAP.md`.

## Testing

| Area | Command / check |
|------|------------------|
| API + WASM boot | `npm run test:api` (needs `packages/api/wasm/`) |
| Demo build | `npm run build:demo` |
| Native kernel | `npm run build:native` / `npm test` |
| Playwright bake-off | `npm run build:demo && npm run test:e2e` |
| Manual | `npm run dev` — Run / Install / HTTP / Files pane |

## Documentation

- User-facing behavior → `README.md`
- Roadmap → `ROADMAP.md`
- Architecture → `docs/ARCHITECTURE.md`
- Node module matrix → `runtime/node/MODULES.md` (if present)

## Security

Do not open public issues for vulnerabilities. See [`SECURITY.md`](./SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the MIT License (project root [`LICENSE`](./LICENSE)).
