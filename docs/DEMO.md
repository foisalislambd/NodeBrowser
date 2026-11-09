# Demo workbench

`demo/` is a simple workspace over the WASM kernel: files, code, one terminal, and a preview. It is not a second runtime.

Local: `npm run dev` → http://localhost:5173  
Pages: https://foisalislambd.github.io/NodeBrowser/ — [PAGES.md](./PAGES.md)

## Layout

- Top bar: **Run**, **Save**, **Preview**, **Commands** (`Ctrl+K`), and **More** for install, templates, zip, and GitHub
- Left: **Files**, **Search**, **Start** (Vite / Next / Express), **About**
- Center: the open file, with the terminal underneath
- Right: preview
- Narrow screens: bottom bar switches Files, Code, Terminal, and Preview

Boot: splash → WASM → optional OPFS `/home` → terminal welcome. Empty starter workspaces **do not** auto-run HTTP; use F5 / Run File.

## Search, zip, GitHub

Search (Ctrl+Shift+F) looks through file contents under `/home`, not only filenames. Replace writes the replacement across those files. File → Export ZIP downloads `/home/project` without `node_modules`. Clone GitHub Repo takes a public `owner/repo` and a branch (default `main`).

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
