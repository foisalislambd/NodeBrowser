# Roadmap

Full detail lives in [`PLAN.md`](./PLAN.md) — including **WebContainers parity** (what they have vs what we must add).

## North star

Open-source **WebContainers-class** runtime: real `npm` / Vite / Next-subset **in the browser tab**, no remote compute VM.

## Already like WebContainers (early)

- C++ → **WASM** kernel + VFS + spawn  
- Service Worker preview  
- npm install into VFS  
- Host API (`boot` / `mount` / `spawn`)  
- Demo file manager  

## Must add to match WC feel

See the big checklist in [`PLAN.md` → WebContainers parity](./PLAN.md#webcontainers-parity--what-they-have-vs-what-we-must-add).

Highest leverage next:

1. **OPFS** — project survives refresh  
2. **WASM HTTP keep-alive** — real servers like WC  
3. **fs.watch / ESM / npm run+npx** — tooling foundation  
4. **Vite in-tab + HMR**  
5. **Next subset in-tab**  
6. **xterm + multi-port preview**  
7. **WebContainer API compat shim**  
8. **Benchmarks vs WebContainers**

## Non-goals

Native `.node` addons, raw internet TCP, perfect Node parity, full Turbopack/enterprise Next, copying proprietary WC internals — see `PLAN.md`.
