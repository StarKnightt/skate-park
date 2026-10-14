#!/usr/bin/env bash
# Full skater pipeline: SDF model -> face textures -> Blender rig + Mixamo clips -> optimised GLBs
# (public/models/skater.glb + public/models/people.glb, public/textures/face_*.webp).
# Only the Blender step is a heavy job: it takes the global lock itself (run this script directly, not via heavy.sh).
# Raw Mixamo FBX are read in place, never copied. SKIP_SDF=1 reuses the existing parts.
set -euo pipefail
cd "$(dirname "$0")/.."
B=.agent-notes/build
BLENDER=/e/blender/blender-5.1.2-windows-x64/blender.exe
OWNER=${HEAVY_OWNER:-chars}
mkdir -p "$B/parts"
if [ "${SKIP_SDF:-0}" != "1" ]; then
  python tools/character/sdf_skater.py "$B/parts" "$B/bryce_skeleton.json" > "$B/sdf.log" 2> "$B/sdf.err"
  tail -3 "$B/sdf.log"
fi
python tools/character/paint_face.py "$B/face.png" public/textures
rm -f "$B/skater_raw.glb" "$B/people_raw.glb"
bash tools/heavy.sh "$OWNER" "$BLENDER" -b --factory-startup --threads 8 --python-exit-code 1 \
  --python tools/blender/build_skater.py -- "$B/skater_cfg.json" > "$B/build.log" 2> "$B/build.log.err"
grep -E "^(weights|body|proxy|uv|color|Col1)" "$B/build_skater.log" || true
optimise() {  # <raw.glb> <out.glb>
  local s="${1%_raw.glb}"
  npx gltf-transform resample "$1" "${s}_rs.glb" > /dev/null
  npx gltf-transform prune "${s}_rs.glb" "${s}_pr.glb" --keep-attributes true > /dev/null
  npx gltf-transform webp "${s}_pr.glb" "${s}_wp.glb" --quality 90 > /dev/null
  npx gltf-transform meshopt "${s}_wp.glb" "$2" --level medium > /dev/null
}
optimise "$B/skater_raw.glb" "$B/skater_opt.glb"
optimise "$B/people_raw.glb" "$B/people_opt.glb"
# web slimming: played clips only, int16 + meshopt quaternions, people.glb = crowd clips + baked LODs on the skater mesh
bash tools/assets/slim_glb.sh "$B/skater_opt.glb" "$B/people_opt.glb" public/models
ls -la public/models/*.glb public/textures/face_*.webp
