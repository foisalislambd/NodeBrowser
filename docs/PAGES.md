# Demo on GitHub Pages

The playground is static — no backend. Runtime, VFS, npm-in-VFS, and HTTP preview all run in the tab.

**URL:** https://foisalislambd.github.io/NodeBrowser/

## How it deploys

Workflow: [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)

On every push to `main`:

1. Emscripten **C++ → WASM** (`scripts/ci-build-cpp-wasm.sh`)
2. `npm run build:demo` — Vite + [`vite-basepath`](https://www.npmjs.com/package/vite-basepath) (`base: './'`), plus API, WASM, and `esbuild-wasm` in `demo/dist`
3. Deploys `demo/dist` via GitHub Pages (works at `/NodeBrowser/` without a `BASE_PATH` env)

## One-time repo setting

GitHub → **Settings** → **Pages** → **Source:** GitHub Actions

## Local static check

```bash
npm run build:api
npm run build:demo
npm run preview
```

`vite-basepath` emits relative asset URLs, so the same `demo/dist` works at `/` and at `https://<user>.github.io/NodeBrowser/`. Local `npm run dev` uses Vite at `http://localhost:5173`.
