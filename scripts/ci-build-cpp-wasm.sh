#!/usr/bin/env bash
# CI helper: Emscripten must already be on PATH (emcmake/emcc).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v emcmake >/dev/null 2>&1; then
  echo "emcmake not on PATH — run emscripten-core/setup-emsdk (or scripts/setup-toolchain.sh) first" >&2
  exit 1
fi

echo "==> Fetch QuickJS / submodules"
bash scripts/fetch-deps.sh

echo "==> Build C++ kernel → WASM (Emscripten)"
bash scripts/build-wasm.sh

test -f packages/api/wasm/browsernode_kernel.wasm
test -f packages/api/wasm/browsernode_kernel.js
ls -lh packages/api/wasm/browsernode_kernel.*

echo "==> Build TypeScript API"
npm run build:api

# Re-assert WASM still present after copy-wasm.mjs
test -f packages/api/wasm/browsernode_kernel.wasm
test -f packages/api/dist/index.js

echo "C++/WASM + API ready for publish/demo"
