# User guide

How to use NodeBrowser as a person or an agent. API details: [API.md](./API.md). Demo chrome: [DEMO.md](./DEMO.md). npm: [NPM.md](./NPM.md). Tailwind: [TAILWIND.md](./TAILWIND.md). Honest limits: [LIMITS.md](./LIMITS.md).

## What you are running

The “server” is a **C++ kernel compiled to WebAssembly** in the same tab. Guest JavaScript is **QuickJS inside that WASM**, not Chromium’s V8 and not your laptop’s Node.

The TypeScript package `@foisal/nodebrowser` only **loads WASM**, fetches npm tarballs, talks to a Service Worker for preview, and shims bundlers. It is not a second Node.

Live demo: https://foisalislambd.github.io/NodeBrowser/  
Local: `npm run dev` → http://localhost:5173 (COOP/COEP headers on).

## Where files live

| Path you type | Where it is |
|---------------|-------------|
| `/home/project/index.js` | Kernel **VFS** (RAM). Optional persist: browser **OPFS** for `/home` |
| `node_modules/` after `npm install` | Same VFS: `/home/project/node_modules` |
| This git repo’s `node_modules/` | Host machine only (Vite, tests) — **not** the guest |

Explorer, Save, Upload ZIP, and the terminal all use the **same VFS**.

## Language law

| Layer | Language | Allowed to implement |
|-------|----------|----------------------|
| Guest Node (`fs`, `http`, `require`, …) | **C++ + QuickJS** in `kernel/` and `kernel/embed/guest_modules.js` | Yes |
| Host `@foisal/nodebrowser` | **TypeScript** | WASM load, npm fetch, OPFS, Service Worker, esbuild-wasm — **not** guest Node |
| Demo UI | **JavaScript** in `demo/src` | Workbench only |

New core modules go in the kernel embed, then `scripts/gen-guest-modules.sh`. Do not add a fake `fs` in the demo.

## Terminal (same commands as a PC, subset)

The demo runs `spawn('sh', ['-c', line], { cwd })`.

```bash
node index.js
npm install lodash
npm install tailwindcss @tailwindcss/browser
npx tailwindcss -i ./src/input.css -o ./dist/output.css
npm ls
npm run <script>
```

`npm` and `npx tailwindcss` are intercepted on the **host** so logs stream and native CLIs are not required. Packages still land in the VFS. Details: [NPM.md](./NPM.md), [TAILWIND.md](./TAILWIND.md).

Prefer **one command per line**. `&&` / `|` / `;` in a single `sh -c` string are not rewritten by the intercept.

## Your own page (no demo UI)

```ts
import { NodeBrowser } from '@foisal/nodebrowser';

const bn = await NodeBrowser.boot({ persist: true, previewBase: '/__bn_preview' });
bn.attachServiceWorkerBridge('/__bn_preview');
await bn.install(['lodash'], '/home/project');
const proc = await bn.spawn('node', ['index.js'], { cwd: '/home/project' });
for await (const chunk of proc.output) console.log(chunk);
```

Serve with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.

`boot()` **throws** if `browsernode_kernel.wasm` is missing. There is no JavaScript guest Node fallback.

Full method list: [API.md](./API.md).
