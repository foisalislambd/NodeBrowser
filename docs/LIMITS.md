# Limits — what actually runs

NodeBrowser is a **growing Node subset** on QuickJS + WASM. It is not bit-identical Node, V8, or libuv.

Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md). npm path: [NPM.md](./NPM.md).

## Works well (tested)

Install + `require()` / run in guest:

- Small CJS: `left-pad`, `ms`, `minimist`, `picocolors`
- Popular CJS: `lodash`
- Nested tiny graphs: `is-even`
- `debug` (small)
- `typescript` (JS compiler loads; not a claim that every `tsc` flag matches)
- Tailwind packages + in-tab compile: [TAILWIND.md](./TAILWIND.md)
- Host `npm install` / `npm ls` intercept

Native packages **install** (JS stub or skip) and **fail clearly at run**: `esbuild`, `fsevents` (`BN_GRAPH: native …`).

## Often fails at run (install may succeed)

| Kind | Example | Typical failure |
|------|---------|-----------------|
| Heavy / ESM-first | `zod`, `semver` (current QuickJS) | Stack overflow / WASM OOB |
| Express-class | `express` | Node-only patterns (`depd` `getStack`, etc.) |
| Native addons | `fsevents`, `esbuild` .node, sharp | Cannot load in QuickJS |
| Full Vite 8 / `next start` | — | In-tab **subset** (esbuild-wasm + shims). ZIP the **source** folder; `node_modules` / `.next` / `.git` are skipped. |
| Scoped `@types/*` extract | `@types/ms` | Extra nest (`…/@types/ms/ms/`) — hoist bug |

## Out of scope on purpose

- Bit-identical Node / V8 performance
- Raw guest TCP to the public internet (virtual HTTP + allowlisted npm fetch)
- Hardened multi-tenant jail — see [../SECURITY.md](../SECURITY.md)
- Executing yarn/pnpm instead of the in-tab npm installer

## Shell intercept

Host rewrites simple `npm …` and `npx tailwindcss …` lines. Combined `sh -c 'a && b'` is left to the kernel shell and is **not** a second npm parser.
