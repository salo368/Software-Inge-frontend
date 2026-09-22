#!/usr/bin/env bash
# Regenerates the checked-in E2E fixtures by delegating to the
# `make_synthetic_*` helpers in the backend integration test suite.
# Requires a checkout of Software-Inge-backend as a sibling directory
# and Python + Pillow available on PATH (`pip install pillow` in the
# backend venv is enough).
#
# Run this whenever the synthetic helpers change (font size, layout,
# ...) so the PNGs the frontend E2E consumes stay in sync with what
# the backend integration tests believe is a valid ID / signature.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend="${here%/Software-Inge-frontend/e2e/fixtures}/Software-Inge-backend"

if [ ! -d "$backend" ]; then
  echo "Expected backend sibling at $backend but did not find it." >&2
  echo "Clone Software-Inge-backend next to Software-Inge-frontend." >&2
  exit 1
fi

cd "$backend"
python - <<PY
import sys
sys.path.insert(0, 'backend')
from tests.integration_signatures import (
    make_synthetic_id_png,
    make_synthetic_signature_png,
)

out = "$here"
open(f"{out}/id-front.png", "wb").write(make_synthetic_id_png("front"))
open(f"{out}/id-back.png",  "wb").write(make_synthetic_id_png("back"))
open(f"{out}/signature.png", "wb").write(make_synthetic_signature_png())
print("Regenerated 3 fixtures under", out)
PY
