#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "${ROOT}/scripts/gen-guest-modules.mjs"
