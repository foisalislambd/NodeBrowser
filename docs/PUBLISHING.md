# Publishing BrowserNode packages to npm

This guide covers **package naming**, **what to publish**, and **how to publish** safely.

## Package names (recommended)

Use an **npm org scope** so related packages stay under one brand:

| Package name | Path | Publish? | Purpose |
|--------------|------|----------|---------|
| `@browsernode/api` | `packages/api` | **Yes** | Public host API (`BrowserNode.boot`, VFS, spawn, install, …) |
| `browsernode` (root) | repo root | **No** | Private monorepo workspace (`"private": true`) |
| `demo` | `demo/` | **No** | Local playground only |

### Future packages (same scope)

When you split the monorepo further, keep the `@browsernode/` prefix:

| Name | Idea |
|------|------|
| `@browsernode/api` | Core runtime API (current) |
| `@browsernode/kernel` | Prebuilt WASM artifacts only (optional split) |
| `@browsernode/webcontainer-compat` | StackBlitz-shaped compat shim (see PLAN) |
| `@browsernode/react` | Optional React hooks / provider (later) |

**Rules of thumb**

- Prefer **scoped** names (`@browsernode/...`) — clearer, fewer collisions.
- Create the org on npm: https://www.npmjs.com/org/create → org name `browsernode`.
- Package name must match `package.json` `"name"` exactly.
- Unscoped `browsernode` can be reserved later as a thin meta-package that re-exports `@browsernode/api` — optional.

### Check if a name is free

```bash
npm view @browsernode/api
# 404 / not found  → available (or private to you)
```

---

## One-time npm setup

1. Create an [npm account](https://www.npmjs.com/signup).
2. Enable **2FA** (required for publishing in modern npm).
3. Create org **`browsernode`** (or your chosen scope) and add yourself as owner.
4. Login locally:

```bash
npm login
npm whoami
```

5. For CI publishing later, create a granular access token (Automation) and store it as `NPM_TOKEN` in GitHub Secrets — do **not** commit tokens.

---

## What gets published

Only **`@browsernode/api`** for now.

From `packages/api/package.json`:

- `"files": ["dist", "wasm"]` — only built JS/types + WASM assets
- `"publishConfig": { "access": "public" }` — needed for scoped public packages
- Root and `demo` stay `"private": true`

Build before every publish:

```bash
npm run build:api
```

Confirm the tarball contents:

```bash
npm pack -w @browsernode/api --dry-run
```

You should see `dist/*.js`, `dist/*.d.ts`, and wasm files — **not** `src/`, tests, or `node_modules`.

---

## Versioning

Follow [SemVer](https://semver.org/):

| Bump | When |
|------|------|
| `0.1.0` → `0.1.1` | Bugfix, docs in package (patch) |
| `0.1.0` → `0.2.0` | New APIs, compatible changes (minor) while `0.x` |
| `0.x` → `1.0.0` | Stable public API commitment |
| `1.0.0` → `2.0.0` | Breaking API changes |

Update **both** when releasing:

- `packages/api/package.json` → `"version"`
- Root `package.json` → `"version"` (repo release tag alignment)
- [`CHANGELOG.md`](../CHANGELOG.md)

---

## Publish checklist

1. [ ] CI green on `main`
2. [ ] `CHANGELOG.md` updated
3. [ ] Version bumped in `packages/api/package.json`
4. [ ] `repository` / `homepage` / `bugs` URLs no longer say `YOUR_ORG`
5. [ ] `npm run build:api`
6. [ ] `npm pack -w @browsernode/api --dry-run` looks correct
7. [ ] Git tag `vX.Y.Z` pushed + GitHub Release notes
8. [ ] Publish (below)

---

## Publish commands

### First public publish (scoped)

```bash
cd /path/to/browsernode
npm run build:api

# Public scoped package (required on first publish)
npm publish -w @browsernode/api --access public
```

`publishConfig.access` is already `"public"` in `packages/api/package.json`, so later:

```bash
npm publish -w @browsernode/api
```

### Verify

```bash
npm view @browsernode/api version
npm view @browsernode/api
```

Install smoke test in an empty folder:

```bash
mkdir /tmp/bn-smoke && cd /tmp/bn-smoke
npm init -y
npm install @browsernode/api
node -e "import('@browsernode/api').then(m => console.log(Object.keys(m)))"
```

### Consumers

```bash
npm install @browsernode/api
```

```ts
import { BrowserNode } from '@browsernode/api';
```

CDN / ESM bundlers: publish ESM (`"type": "module"`) is already set — use your bundler; raw browser import may need an import map for `esbuild-wasm`.

---

## GitHub Release + npm together

```bash
# after changelog + version bump committed
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0

npm run build:api
npm publish -w @browsernode/api --access public
```

Then create a GitHub Release from the tag (paste the changelog section).

More tagging notes: [`RELEASING.md`](./RELEASING.md).

---

## Optional: GitHub Actions publish

Example job (run only on version tags):

```yaml
# .github/workflows/publish.yml (add when ready)
name: Publish
on:
  push:
    tags: ['v*']
jobs:
  npm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: https://registry.npmjs.org
      - run: npm install
      - run: npm run build:api
      - run: npm publish -w @browsernode/api --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Common mistakes

| Mistake | Fix |
|---------|-----|
| `ENEEDAUTH` | `npm login` / check 2FA |
| `402 Payment Required` / forbidden scope | Create npm org or use `--access public` |
| Publishing root workspace | Root is `private: true` — publish `-w @browsernode/api` only |
| Missing `dist/` | Always `npm run build:api` first |
| Wrong name already taken | Change scope/org or package name before first publish |
| Publishing secrets / `.env` | Keep them out of `"files"` and `.gitignore` |

---

## Unpublish / deprecate

- npm only allows unpublish in a short window / under policy — prefer **`npm deprecate`**:

```bash
npm deprecate @browsernode/api@0.1.0 "Use @browsernode/api@0.2.0"
```

- Yanking a widely used version hurts users — bump a patch instead when possible.
