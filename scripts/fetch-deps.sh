#!/usr/bin/env bash
# Fetch Git submodules (QuickJS, …)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git submodule update --init --recursive
echo "Submodules ready:"
git submodule status
