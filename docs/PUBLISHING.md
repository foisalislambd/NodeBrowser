# Publishing `@foisal/nodebrowser`

## Short answer

| Question | Answer |
|----------|--------|
| Public npm name | **`@foisal/nodebrowser`** |
| Import | `import { NodeBrowser } from '@foisal/nodebrowser'` |
| Auto release | Push to **`main`** → build → npm (Trusted Publisher) → GitHub Packages → GitHub Release |

```bash
npm install @foisal/nodebrowser
```

```ts
import { NodeBrowser } from '@foisal/nodebrowser';

const bn = await NodeBrowser.boot();
```

---

## Package names in this repo

| npm `name` | Path | Publish? | Role |
|------------|------|----------|------|
| **`@foisal/nodebrowser`** | `packages/api` | **Yes** (npm) | Public API |
| `@<github-owner>/nodebrowser` | same tarball | **Yes** (GitHub Packages) | Mirror; scope must match GitHub owner |
| `nodebrowser-monorepo` | repo root | **No** (`private`) | Workspace root |
| `demo` | `demo/` | **No** | Playground |

> GitHub Packages requires the package scope to equal the repository owner. This repo is under **`foisalislambd`**, so the GitHub Packages name is **`@foisalislambd/nodebrowser`**. Canonical install path for everyone else is still **`@foisal/nodebrowser`** on the public npm registry.

---

## Automated release (preferred)

Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml)

On every push to `main` (unless the commit message contains `[skip release]`):

1. **C++ → WASM** via Emscripten (`scripts/ci-build-cpp-wasm.sh`) + native C++ tests
2. TypeScript API + demo + conformance
3. Resolve next version (`1.0.0` → `1.0.1` → … → `1.0.9` → `1.1.0`; patch/minor roll at **9**)
4. Publish to **npm** via **Trusted Publisher (OIDC)** — tarball includes freshly built `wasm/`
5. Publish to **GitHub Packages**
6. Tag `vX.Y.Z` + **GitHub Release**
7. Commit version bump + WASM binaries (`[skip release]`)

### One-time npm Trusted Publisher setup

1. Claim / create **`@foisal/nodebrowser`** on [npmjs.com](https://www.npmjs.com) under the **`foisal`** scope.
2. Package → **Settings** → **Trusted Publisher** → **GitHub Actions**:
   - **Organization or user:** `foisalislambd`
   - **Repository:** `NodeBrowser`
   - **Workflow filename:** `release.yml` (filename only)
   - Allowed action: **`npm publish`**
3. Use a **public** repo for automatic provenance.
4. No `NPM_TOKEN` secret is required for publish.

Requirements: GitHub-hosted runner, Node 24 + npm ≥ 11.5.1 (workflow installs latest npm).

### GitHub Packages

Uses `GITHUB_TOKEN` (`packages: write`). Consumers:

```bash
# ~/.npmrc
@foisalislambd:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GH_TOKEN

npm install @foisalislambd/nodebrowser
```

---

## Manual publish (emergency only)

```bash
npm run build:api
npm pack -w @foisal/nodebrowser --dry-run
npm publish -w @foisal/nodebrowser --access public
```

Prefer the Trusted Publisher workflow instead of long-lived tokens.

---

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Publishing monorepo root | Use `-w @foisal/nodebrowser` |
| Trusted Publisher workflow name typo | Must be exactly `release.yml` |
| Missing `id-token: write` | Required for OIDC |
| Expecting `@foisal/…` on GitHub Packages | Scope must match GitHub owner |
| Using name `browsernode` | Taken — use `@foisal/nodebrowser` |
