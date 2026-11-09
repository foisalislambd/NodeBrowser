# Releasing NodeBrowser

Releases are automatic on push to `main`, using the version in [`VERSION.md`](../VERSION.md).

## Version

[`VERSION.md`](../VERSION.md) has one `X.Y.Z` line. That number is the release.

- Higher than the latest `vX.Y.Z` GitHub release: publish npm, GitHub Packages, and the GitHub Release.
- Same or lower: the build still runs, and no release is created.

Raise the number in `VERSION.md` when you want the next release. Nothing in CI bumps it.

## What happens on `main`

1. Build + tests
2. Read `VERSION.md` and compare it with the latest release tag
3. When the file version is higher, publish **`@foisal/nodebrowser`** to npm (Trusted Publisher / OIDC + provenance)
4. Publish **`@<owner>/nodebrowser`** to GitHub Packages
5. Tag `vX.Y.Z` and create the GitHub Release

A commit message containing `[skip release]` skips the workflow.

## Changelog

Update [`CHANGELOG.md`](../CHANGELOG.md) in the same change as the version bump when the notes matter. The GitHub Release body is a short install blurb.

## Manual emergency tag

Only if automation is broken. Set `VERSION.md` first, then:

```bash
node scripts/release-version.mjs --apply
npm run build:api
npm publish -w @foisal/nodebrowser --access public
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --generate-notes
```

`--apply` writes `VERSION.md` into the package files. If that version is not higher than the latest tag, the script reports `decision=skip` and does not change the packages.
