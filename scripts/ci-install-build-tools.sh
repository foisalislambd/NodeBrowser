#!/usr/bin/env bash
# CMake and Ninja for GitHub Actions without apt.
# ubuntu-latest currently fails DNS for archive.ubuntu.com / security.ubuntu.com.
# g++ is already on the runner image. CMake and Ninja come from GitHub releases.
set -euo pipefail

if ! command -v g++ >/dev/null 2>&1; then
  echo "g++ is not on PATH. This runner image is expected to ship it." >&2
  exit 1
fi

PREFIX="${PREFIX:-/usr/local}"
CMAKE_VERSION="${CMAKE_VERSION:-3.31.8}"
NINJA_VERSION="${NINJA_VERSION:-1.12.1}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch() {
  local url="$1" dest="$2" attempt
  for attempt in 1 2 3 4 5; do
    if curl -fL --retry 3 --retry-delay 2 -o "$dest" "$url"; then
      return 0
    fi
    echo "download attempt ${attempt} failed: ${url}" >&2
    sleep $((attempt * 2))
  done
  return 1
}

if ! command -v cmake >/dev/null 2>&1; then
  fetch "https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-linux-x86_64.tar.gz" "$tmp/cmake.tgz"
  sudo tar -C "$PREFIX" --strip-components=1 -xzf "$tmp/cmake.tgz"
fi

if ! command -v ninja >/dev/null 2>&1; then
  fetch "https://github.com/ninja-build/ninja/releases/download/v${NINJA_VERSION}/ninja-linux.zip" "$tmp/ninja.zip"
  python3 - "$tmp/ninja.zip" "$tmp/ninja-out" <<'PY'
import sys, zipfile
from pathlib import Path
archive, dest = sys.argv[1], Path(sys.argv[2])
dest.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(archive) as zf:
    zf.extractall(dest)
PY
  sudo install -m 755 "$tmp/ninja-out/ninja" "$PREFIX/bin/ninja"
fi

cmake --version
ninja --version
g++ --version
