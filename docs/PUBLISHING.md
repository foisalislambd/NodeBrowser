# Publishing BrowserNode to npm

## Short answer

| Question | Answer |
|----------|--------|
| Can we publish as plain **`browsernode`**? | **No — that name is already taken** on npm by another project ([browsernode@0.4.x](https://www.npmjs.com/package/browsernode), browser automation). |
| What do we publish instead? | **`browsernode-runtime`** (chosen unscoped name — free). |
| Will more packages appear later? | **Maybe** (`@browsernode/webcontainer-compat`, etc.). Day one = one package only. |

```bash
npm install browsernode-runtime
```

```ts
import { BrowserNode } from 'browsernode-runtime';
```

### Alternatives (also free today)

| Name | Style | Notes |
|------|--------|--------|
| **`browsernode-runtime`** | unscoped | **Current choice** — clear, available |
| `browser-node` | unscoped | Also free |
| `@browsernode/core` | scoped | Good if you create npm org `browsernode` and expect many packages |
| `@browsernode/api` | scoped | Free, but we avoid this name by preference |

To switch the published name later, change `"name"` in `packages/api/package.json` **before the first publish** (renaming after publish requires a new package).

---

## Package names in this repo

| npm `name` | Path | Publish? | Role |
|------------|------|----------|------|
| **`browsernode-runtime`** | `packages/api` | **Yes** | Public API |
| `browsernode-monorepo` | repo root | **No** (`private`) | Workspace root |
| `demo` | `demo/` | **No** | Playground |

Root cannot also be called `browsernode-runtime` — workspace names must be unique. The published library owns the public name.

---

## Future packages

PLAN allows optional splits later:

| Possible later name | When |
|---------------------|------|
| `@browsernode/webcontainer-compat` | StackBlitz-shaped API shim |
| `@browsernode/kernel` | Prebuilt WASM-only artifact |
| `@browsernode/react` | React helpers |

Until then, **one package is enough**. Create npm org `browsernode` only when you add `@browsernode/*` packages.

---

## One-time setup

```bash
npm login
npm whoami
npm view browsernode-runtime   # expect 404 until first publish
```

Enable 2FA on npm.

---

## Publish

```bash
npm run build:api
npm pack -w browsernode-runtime --dry-run
npm publish -w browsernode-runtime
```

Verify:

```bash
npm view browsernode-runtime version
```

Checklist / tags: [`RELEASING.md`](./RELEASING.md).

---

## Versioning

SemVer in `packages/api/package.json` + git tag `vX.Y.Z` + [`CHANGELOG.md`](../CHANGELOG.md).

---

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Trying to publish as `browsernode` | Name taken — use `browsernode-runtime` |
| Publishing monorepo root | Root is private — use `-w browsernode-runtime` |
| Missing `dist/` | `npm run build:api` first |
