# npm in the tab

Packages install into the **kernel VFS** (`cwd/node_modules`), not the machine that runs Vite. Same intent as a PC: registry tarballs, hoist, lockfile, `package.json` deps.

API: `bn.install(packages, cwd, opts?)` — see [API.md](./API.md).  
Terminal: `spawn('sh', ['-c', 'npm install lodash'])` is intercepted on the host.

## Commands the host accepts

| Command | Effect |
|---------|--------|
| `npm install` / `i` / `add` / `ci` | Empty specs → `package.json` dependencies |
| `npm install lodash` | Named specs (repeatable) |
| `npm install -D typescript` / `--save-dev` | `devDependencies` |
| `npm uninstall` / `un` / `remove` / `rm` | Remove from VFS + manifest |
| `npm ls` / `list` | Installed names@versions |
| `npm run <script>` | `bn.runScript` |

The **first positional** is the subcommand. `npm install ls` installs a package named `ls`; it is not `npm ls`.

`yarn` / `pnpm` lockfiles are **detected** and warned; install still uses this npm path (corepack is not executed).

## What install does

1. Resolve versions from `https://registry.npmjs.org` (allowlisted fetch).
2. Fetch tarballs (memory cache, parallel deps).
3. Gunzip + kernel tar extract; hoist the npm `package/` prefix.
4. Write `node_modules/<name>/`, `.bin` shims, lockfile, `package.json`.
5. Skip **native** optional/platform packages (cannot run `.node` in WASM): `esbuild`, `fsevents`, `lightningcss-*`, `@tailwindcss/oxide*`, `@esbuild/*`, `@swc/core-*`, … JS wrappers may still be present.
6. **Do not auto-install peerDependencies** (warning only).
7. Ranges: `^` / `~` / `>=` / `1` (major) / `1.2` (major.minor) / `||`. Git/file/http specs are skipped.
8. After `tailwindcss` (or a bare `npm install` of the manifest), sync `@tailwindcss/browser` IIFE into `/usr/share/nodebrowser/tailwind-browser.js` when present.

## Progress events

```ts
bn.on('install-progress', (p) => {
  // p.phase: resolve | fetch | extract | bin | lifecycle | done | summary
  if (p.streamed) return; // already on process stdout
  console.log(p.message ?? `${p.phase} ${p.name}`);
});
```

## `npx`

`bn.npx('pkg', args, cwd)` reads `node_modules/.bin/<bin>`, or installs then retries. `npx tailwindcss …` is a **host Tailwind compile**, not the native oxide CLI ([TAILWIND.md](./TAILWIND.md)).

## Honest limits

See [LIMITS.md](./LIMITS.md). Small CJS libraries (`lodash`, `ms`, `minimist`) typically `require()` in QuickJS. Express-class stacks, heavy ESM (`zod`), and native addons often fail at **run** even when **install** succeeds.
