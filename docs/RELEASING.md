# Releasing BrowserNode

1. Update [`CHANGELOG.md`](../CHANGELOG.md) — move Unreleased notes into `X.Y.Z`.
2. Bump `version` in root `package.json` and `packages/api/package.json`.
3. Ensure CI is green on `main`.
4. Tag and push:

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

5. Create a GitHub Release from the tag; paste the changelog section.
6. Publish `@browsernode/api` to npm — see the full guide:

→ **[`PUBLISHING.md`](./PUBLISHING.md)** (package names, org scope, `npm publish`, checklist)

Short version:

```bash
npm run build:api
npm publish -w @browsernode/api --access public
```

Replace `YOUR_ORG` placeholders in README badges / `package.json` `repository` fields before publishing.
