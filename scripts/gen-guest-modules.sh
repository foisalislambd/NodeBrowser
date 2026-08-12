#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - <<PY
from pathlib import Path
src = Path("${ROOT}/kernel/embed/guest_modules.js").read_text()
delim = "GUESTJS"
out = Path("${ROOT}/kernel/src/generated_guest_modules.hpp")
out.write_text(
    "// AUTO-GENERATED from kernel/embed/guest_modules.js — do not edit\\n"
    "#pragma once\\n"
    f'static const char kGuestModules[] = R"{delim}(\\n' + src + f'\\n){delim}";\\n'
)
print("generated", out)
PY
