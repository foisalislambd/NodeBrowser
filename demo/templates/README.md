# Demo app templates

Real scaffolded apps (not hand-rolled stubs):

| Folder | Created with | Host commands |
|--------|----------------|---------------|
| `vite/` | `create-vite` (React) | `npm run dev:vite` · `build:vite` · `preview:vite` |
| `next/` | `create-next-app` (App Router) | `npm run dev:next` · `build:next` · `start:next` |

The NodeBrowser demo UI can **Load** these into the VFS (`/apps/vite`, `/apps/next`). Full Vite/Next CLIs still run on the host until NodeBrowser can host them in-tab.
