# Roadmap

Full detail lives in [`PLAN.md`](./PLAN.md). This is the short public view.

## North star

Open-source **WebContainers-class** runtime: real `npm` / Vite / Next-subset **in the browser tab**, no remote compute VM.

## Done (0.1 → Phase 13)

- Kernel + JS/WASM paths, VFS, spawn, HTTP preview, npm→VFS
- Node subset (fs/http/crypto/…)
- Demo file manager + Vite/Next **host** templates
- Phase 13: `rename`, binary `readFile(...,'buffer')`, spawn `env`, `useWasm: 'auto'`, `npm run test:api`

## Next (highest leverage)

1. OPFS persistence (survive refresh)  
2. File watch + symlink polish  
3. ESM module system  
4. npm bin / `npm run` / npx  
5. **Vite fully in-tab** (HMR)  
6. Process/shell 2.0 as needed  
7. Next.js supported subset in-tab  
8. WASM HTTP keep-alive full parity

## Then

- Terminal (xterm) + stronger IDE UX  
- Publish `@foisal/nodebrowser` + docs site
- WebContainer API compat shim  
- Performance benchmarks vs WebContainers  
- Agent/automation headless API  

## Non-goals

Native `.node` addons, raw internet TCP, perfect Node parity, full Turbopack/enterprise Next — see `PLAN.md`.
