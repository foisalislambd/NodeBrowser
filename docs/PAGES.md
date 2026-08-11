# Demo on GitHub Pages

The playground is static — no backend. Runtime, VFS, npm-in-VFS, and HTTP preview all run in the tab.

**URL:** https://foisalislambd.github.io/NodeBrowser/

## How it deploys

Workflow: [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)

On every push to `main`:

1. `npm run build:api`
2. `BASE_PATH=/NodeBrowser/ npm run build:demo` — copies API, WASM, and `esbuild-wasm` into `demo/dist`
3. Deploys `demo/dist` via GitHub Pages

## One-time repo setting

GitHub → **Settings** → **Pages** → **Source:** GitHub Actions

## Local static check

```bash
npm run build:api
BASE_PATH=/ npm run build:demo
npm run dev
```

For a Pages-like base path locally you would need a reverse-proxy prefix; normally use `BASE_PATH=/`.
