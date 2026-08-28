# Demo app templates

Real scaffolded apps (not hand-rolled stubs):

| Folder | Created with | Host commands |
|--------|----------------|---------------|
| `vite/` | `create-vite` (React) | `npm run dev:vite` · `build:vite` · `preview:vite` |
| `next/` | `create-next-app` (App Router) | `npm run dev:next` · `build:next` · `start:next` |
| `express/` | Express example | `node demo/templates/express/server.js` (host) |

The NodeBrowser demo **Load + Preview** buttons run an **in-tab** Vite/Next subset (esbuild-wasm + C++ VFS). Upstream `vite`/`next` CLIs are not executed inside QuickJS.
