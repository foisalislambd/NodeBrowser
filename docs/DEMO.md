# Demo workbench

`demo/` is a **VS Code Dark+–style** UI over the WASM kernel. It is not a second runtime.

Local: `npm run dev` → http://localhost:5173  
Pages: https://foisalislambd.github.io/NodeBrowser/ — [PAGES.md](./PAGES.md)

## Layout

- Title bar: File / Edit / View / Run / Terminal / Help, command center (`Ctrl+K`)
- Activity bar: Explorer, Search, Run and Debug, Templates, Simple Browser, Settings
- Sidebar: **PROJECT** tree on the VFS (`/home`, `/usr`, …)
- Editor: open file, breadcrumbs, dirty dot, Save
- Panel: **PROBLEMS** / **TERMINAL** / **OUTPUT** / **DEBUG CONSOLE**
- Status bar: WASM ready, cwd, line/col, LF, UTF-8
- Right: **Simple Browser** (preview iframe + virtual localhost)

Boot: splash → WASM → optional OPFS `/home` → terminal welcome. Empty starter workspaces **do not** auto-run HTTP; use F5 / Run File.

## Keys

| Keys | Action |
|------|--------|
| `Ctrl+K` | Command palette |
| `Ctrl+S` | Save |
| `Ctrl+N` | New file |
| `Ctrl+J` | Toggle panel |
| `` Ctrl+` `` | Focus terminal |
| `Ctrl+Shift+E` / `F` / `D` | Explorer / Search / Run |
| `F5` | Run file |

**Install Package…** uses a VS Code-style quick input (Enter confirms, Escape cancels).

## Run and Debug

| Button | What it does |
|--------|----------------|
| Run File | `node` on the open `.js` |
| Install Package… | `npm install <spec>` into VFS |
| Install Tailwind CSS | see [TAILWIND.md](./TAILWIND.md) |
| Compile Tailwind | `npx tailwindcss -i ./src/input.css -o ./dist/output.css` |
| HTTP Demo | sample `http` server + Simple Browser |
| Bundle | esbuild-wasm |
| Preview Project | `previewProject` / templates |

Templates (Vite / Next / Express) replace `/home/project` then preview. Those in-tab copies are not the same as `npm run dev:vite` on the host (real Node, for comparison).

## Source

Workbench: `demo/src/app/main.js`, `demo/index.html`, `demo/src/index.css` (Tailwind for **chrome only**).
