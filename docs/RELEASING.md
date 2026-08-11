# Releasing NodeBrowser

Releases are **automatic** on push to `main`. See [`PUBLISHING.md`](./PUBLISHING.md).

## Version scheme

`1.0.0` → `1.0.1` → … → `1.0.9` → `1.1.0` → … → `1.9.9` → `2.0.0`

Patch and minor each roll over at **9**.

## What happens on `main`

1. CI build + tests  
2. Publish **`@foisal/nodebrowser`** to npm (Trusted Publisher / OIDC + provenance)  
3. Publish **`@<owner>/nodebrowser`** to GitHub Packages  
4. Tag `vX.Y.Z` + GitHub Release  

Skip a release: put `[skip release]` in the commit message.

## Changelog

Update [`CHANGELOG.md`](../CHANGELOG.md) before merging noteworthy work to `main` (move Unreleased notes into the next version section when you care about release notes quality). The GitHub Release body is a short install blurb; expand it manually if needed.

## Manual emergency tag

Only if automation is broken:

```bash
node scripts/next-version.mjs --set
npm run build:api
npm publish -w @foisal/nodebrowser --access public
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --generate-notes
```
