# Publishing NodeBrowser to npm

## Short answer

| Question | Answer |
|----------|--------|
| Public npm name | **`nodebrowser`** (available on npm) |
| Import | `import { NodeBrowser } from 'nodebrowser'` |
| More packages later? | Optional (`@nodebrowser/compat`, etc.) — day one is one package |

```bash
npm install nodebrowser
```

```ts
import { NodeBrowser } from 'nodebrowser';

const bn = await NodeBrowser.boot();
```

> Note: plain **`browsernode`** is taken by an unrelated project — we intentionally use **`nodebrowser`**.

---

## Package names in this repo

| npm `name` | Path | Publish? | Role |
|------------|------|----------|------|
| **`nodebrowser`** | `packages/api` | **Yes** | Public API |
| `nodebrowser-monorepo` | repo root | **No** (`private`) | Workspace root |
| `demo` | `demo/` | **No** | Playground |

---

## One-time setup

```bash
npm login
npm whoami
npm view nodebrowser   # expect 404 until first publish
```

Enable 2FA on npm.

---

## Publish

```bash
npm run build:api
npm pack -w nodebrowser --dry-run
npm publish -w nodebrowser
```

Verify:

```bash
npm view nodebrowser version
```

Tags / changelog: [`RELEASING.md`](./RELEASING.md).

---

## Future packages (optional)

When the product grows:

| Name | Purpose |
|------|---------|
| `@nodebrowser/webcontainer-compat` | StackBlitz-shaped shim |
| `@nodebrowser/react` | React helpers |

Create npm org `nodebrowser` only when adding scoped packages.

---

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Publishing monorepo root | Use `-w nodebrowser` |
| Missing `dist/` | `npm run build:api` first |
| Using name `browsernode` | Taken — use `nodebrowser` |
