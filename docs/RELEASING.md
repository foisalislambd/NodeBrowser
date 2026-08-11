# Releasing NodeBrowser

1. Update [`CHANGELOG.md`](../CHANGELOG.md) — move Unreleased notes into `X.Y.Z`.
2. Bump `version` in root `package.json` and `packages/api/package.json`.
3. Ensure CI is green on `main`.
4. Tag and push:

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

5. Create a GitHub Release from the tag; paste the changelog section.
6. Publish npm package **`nodebrowser`**:

→ [`PUBLISHING.md`](./PUBLISHING.md)

```bash
npm run build:api
npm publish -w nodebrowser
```

Replace `YOUR_ORG` placeholders in README / `package.json` before publishing.
