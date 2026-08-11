#!/usr/bin/env bash
set -euo pipefail
# User-local toolchain bootstrap (no sudo)
TOOLS="${HOME}/tools"
LOCAL_BIN="${HOME}/.local/bin"
mkdir -p "${TOOLS}" "${LOCAL_BIN}"
export PATH="${LOCAL_BIN}:${TOOLS}/node/bin:${PATH}"

echo "Node: $(node --version 2>/dev/null || echo missing)"
echo "CMake: $(cmake --version 2>/dev/null | head -1 || echo missing)"
echo "Ninja: $(ninja --version 2>/dev/null || echo missing)"

if [[ ! -d "${TOOLS}/emsdk" ]]; then
  echo "Download emsdk zip..."
  cd "${TOOLS}"
  wget -q "https://github.com/emscripten-core/emsdk/archive/refs/heads/main.zip" -O emsdk.zip
  python3 -c "import zipfile; zipfile.ZipFile('emsdk.zip').extractall('.')"
  mv emsdk-main emsdk
  chmod +x emsdk/emsdk emsdk/emsdk.py emsdk/emsdk_env.sh
fi

cd "${TOOLS}/emsdk"
python3 ./emsdk.py install latest
python3 ./emsdk.py activate latest
# shellcheck disable=SC1091
source ./emsdk_env.sh
emcc --version | head -1
echo "Toolchain ready."
