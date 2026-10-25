#!/bin/bash
set -euo pipefail

# Share the same locked release build and optimization settings as pnpm/Vite.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
node scripts/build-wasm.mjs

echo "WASM build complete in pkg/. Run pnpm build to refresh all package bundles."
