# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| `0.1.x` (main) | ✅ |
| older / unreleased forks | ❌ best-effort only |

NodeBrowser runs untrusted-looking workloads **inside the browser tab** (VFS + JS/WASM). Treat it like any other client-side sandbox: isolation is best-effort, not a hardened multi-tenant security boundary yet.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

1. Prefer [GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories) on this repository (“Report a vulnerability”), if enabled.
2. Or email the maintainers (set your contact after publishing; until then use the repo owner’s GitHub email / security advisory form).

Include:

- Description and impact
- Steps to reproduce (PoC if possible)
- Affected commit / version
- Whether you plan a public disclosure timeline

We aim to acknowledge within **7 days** and share a remediation plan when feasible.

## Network egress

Host `fetch` used for npm metadata and tarballs is **allowlisted** (`registry.npmjs.org` / `registry.npmjs.com`, HTTPS only). Guest JS cannot open arbitrary internet sockets; `http.get` / `https.request` throw and tell the caller to use virtual servers.

Do not point the installer at untrusted registries without reviewing `packages/api/src/egress.ts`.

## Scope examples

In scope:

- Escape from intended VFS / process isolation in the demo or `@foisal/nodebrowser` package
- XSS / SW misuse that can steal host-page data beyond the preview sandbox
- Supply-chain issues in published packages (when publishing begins)

Out of scope:

- “I can run `eval` / user JS inside NodeBrowser” (by design)
- Issues only in third-party `demo/templates/*` dependencies
- Denial of service via large npm installs in a local demo tab

## Safe harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations and data destruction
- Report promptly and do not exploit the issue beyond a PoC
- Do not access data that is not their own
