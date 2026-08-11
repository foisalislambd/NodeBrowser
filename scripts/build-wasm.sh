#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.local/bin:${HOME}/tools/node/bin:${PATH}"

if [[ -f "${HOME}/tools/emsdk/emsdk_env.sh" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/tools/emsdk/emsdk_env.sh"
fi

if ! command -v emcmake >/dev/null 2>&1; then
  echo "emcmake not found. Install Emscripten first (see scripts/setup-toolchain.sh)" >&2
  exit 1
fi

OUT="${ROOT}/packages/api/wasm"
mkdir -p "${OUT}"

emcmake cmake -S "${ROOT}" -B "${ROOT}/build-wasm" -G Ninja \
  -DBN_BUILD_WASM=ON \
  -DBN_BUILD_NATIVE_TESTS=OFF \
  -DBN_WITH_QUICKJS=ON

cmake --build "${ROOT}/build-wasm"

# Copy artifacts
cp -f "${ROOT}/build-wasm/kernel/browsernode_kernel.js" "${OUT}/" || \
  cp -f "${ROOT}/build-wasm/kernel/browsernode_kernel.js" "${OUT}/"
cp -f "${ROOT}/build-wasm/kernel/browsernode_kernel.wasm" "${OUT}/"

echo "WASM kernel → ${OUT}"
