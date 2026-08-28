# Governance

## Current stage

NodeBrowser is an early **1.x** open-source project. Day-to-day decisions are made by the **maintainers** listed in the GitHub repository.

## Roles

| Role | Responsibilities |
|------|------------------|
| Maintainer | Merge PRs, release tags, security reports, roadmap (`ROADMAP.md`) |
| Contributor | Patches, reviews, docs, issue triage |

## Decision process

1. Small fixes: PR review by one maintainer.
2. API / architecture changes: discuss in an issue referencing `ROADMAP.md` / `docs/ARCHITECTURE.md` before large implementation.
3. Breaking public API changes: call out in `CHANGELOG.md` and bump semver when publishing packages.

## Releases

- Version lives in root / workspace `package.json` files.
- Tag releases as `vX.Y.Z` and update [`CHANGELOG.md`](./CHANGELOG.md).
- npm publish of `@foisal/nodebrowser` is automated from `main` (Trusted Publisher).

## Becoming a maintainer

Regular, high-quality contributions and sustained review help. Ask via an issue titled “Maintainer interest”.
