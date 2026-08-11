# BrowserNode

**WebContainers-style Node.js runtime in the browser — core in C/C++ → WebAssembly.**

Run `node`, `fs`, CommonJS `require`, and a growing Node API surface entirely client-side. No remote compute VM.

```ts
import { BrowserNode } from '@browsernode/api';

const bn = await BrowserNode.boot();
await bn.mount({
  'index.js': { file: { contents: "console.log('hi from BrowserNode')" } },
});
const proc = await bn.spawn('node', ['index.js']);
proc.output.pipeTo(new WritableStream({ write: (c) => console.log(c) }));
```

## Status (v0.1)

| Capability | State |
|------------|--------|
| In-memory VFS (POSIX-ish) | ✅ |
| Process spawn + stdio pipes | ✅ |
| QuickJS engine (native tests) | ✅ |
| Node builtins: `fs`, `path`, `http` listen, `events`, … | ✅ subset |
| TypeScript host API | ✅ |
| npm install (registry → VFS) | ✅ MVP |
| WASM build (Emscripten) | ⏳ via `scripts/build-wasm.sh` |
| Vite / Next.js | 🔜 (see `PLAN.md`) |

Honest roadmap & architecture: [`PLAN.md`](./PLAN.md), [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Quick start

```bash
# Toolchain (user-local, no sudo): Node, CMake, Ninja, Emscripten
bash scripts/setup-toolchain.sh
source ~/tools/emsdk/emsdk_env.sh
export PATH="$HOME/.local/bin:$HOME/tools/node/bin:$PATH"

# Native kernel tests (g++ + QuickJS)
npm run build:native

# WASM kernel + API + demo
npm install
npm run build:wasm
npm run build:api
# copy demo assets
node demo/build.mjs
npm run dev   # http://localhost:5173  (COOP/COEP on)
```

Without WASM yet, the host API **falls back to an in-browser JS runtime** with the same Node bootstrap — useful for UI/dev.

## Layout

```
kernel/           C++ VFS + process table + C ABI + QuickJS node runner
vendor/           CMake wrapper; QuickJS is a Git submodule → github.com/bellard/quickjs
packages/api/     @browsernode/api (TypeScript)
demo/             Playground UI
scripts/          build-wasm, serve-demo, setup-toolchain, fetch-deps
```

Clone with submodules:

```bash
git clone --recurse-submodules <repo-url>
# or later:
git submodule update --init --recursive
# or:
bash scripts/fetch-deps.sh
```

## Design choice

Upstream Node+V8+libuv → WASM is a multi-year port. BrowserNode embeds **QuickJS** in a C++ kernel and implements Node APIs progressively — same strategy as other open in-browser runtimes, aimed at real `npm`/`vite` workflows over time.

## License

MIT (QuickJS retains its own license — see `vendor/quickjs/LICENSE`).
