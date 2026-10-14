#!/usr/bin/env bash
# Web slimming of the character GLBs + offline people LODs (tools/assets/slim_glb.mjs). Light job (no browser): no lock.
# usage: bash tools/assets/slim_glb.sh <skater_opt.glb> <people_opt.glb> [out_dir=public/models]
set -euo pipefail
cd "$(dirname "$0")/../.."
node tools/assets/slim_glb.mjs "$1" "$2" "${3:-public/models}" | grep -v -E "^(prune|resample):"
