# Roadmap

Full detail lives in [`PLAN.md`](./PLAN.md). This is the short public view.

## North star

Open-source **WebContainers-class** runtime: real `npm` / Vite / Next-subset **in the browser tab**, no remote compute VM.

## Done (0.1)

- Kernel + JS/WASM paths, VFS, spawn, HTTP preview, npm→VFS
- Node subset (fs/http/crypto/…)
- Demo file manager + Vite/Next **host** templates

## Next (highest leverage)

1. WASM/JS parity + conformance tests  
2. OPFS persistence (survive refresh)  
3. File watch + binary files  
4. ESM module system  
5. npm bin / `npm run` / npx  
6. **Vite fully in-tab** (HMR)  
7. Process/shell 2.0 as needed  
8. Next.js supported subset in-tab  

## Then

- Terminal (xterm) + stronger IDE UX  
- Publish `browsernode-runtime` + docs site  
- WebContainer API compat shim  
- Performance benchmarks vs WebContainers  
- Agent/automation headless API  

## Non-goals

Native `.node` addons, raw internet TCP, perfect Node parity, full Turbopack/enterprise Next — see `PLAN.md`.
