# Governance

## Current stage

NodeBrowser is an early (v0.1) open-source project. Day-to-day decisions are made by the **maintainers** listed in the GitHub repository.

## Roles

| Role | Responsibilities |
|------|------------------|
| Maintainer | Merge PRs, release tags, security reports, roadmap (`PLAN.md`) |
| Contributor | Patches, reviews, docs, issue triage |

## Decision process

1. Small fixes: PR review by one maintainer.
2. API / architecture changes: discuss in an issue referencing `PLAN.md` / `docs/ARCHITECTURE.md` before large implementation.
3. Breaking public API changes: call out in `CHANGELOG.md` and bump semver when publishing packages.

## Releases

- Version lives in root / workspace `package.json` files.
- Tag releases as `vX.Y.Z` and update [`CHANGELOG.md`](./CHANGELOG.md).
- npm publish of `nodebrowser` is optional until the API is declared stable.

## Becoming a maintainer

Regular, high-quality contributions and sustained review help. Ask via an issue titled “Maintainer interest”.
