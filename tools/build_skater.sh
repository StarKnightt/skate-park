#!/usr/bin/env bash
# Full skater pipeline: SDF model -> face texture -> Blender rig + Mixamo clips -> optimised GLB.
# Runs every heavy step sequentially at below-normal priority. Raw Mixamo FBX are read in place, never copied.
set -euo pipefail
cd "$(dirname "$0")/.."
B=.agent-notes/build
BLENDER='E:\blender\blender-5.1.2-windows-x64\blender.exe'
mkdir -p "$B/parts"
lowprio() { powershell -NoProfile -Command "\$p = Start-Process -FilePath '$1' -ArgumentList $2 -PassThru -NoNewWindow -RedirectStandardOutput '$3' -RedirectStandardError '$3.err'; \$p.PriorityClass = 'BelowNormal'; \$p.WaitForExit(); exit \$p.ExitCode"; }
if [ "${SKIP_SDF:-0}" != "1" ]; then
  lowprio python "'tools/character/sdf_skater.py','$B/parts','$B/bryce_skeleton.json'" "$B/sdf.log"
fi
python tools/character/paint_face.py "$B/face.png"
lowprio "$BLENDER" "'-b','--factory-startup','--threads','4','--python-exit-code','1','--python','tools/blender/build_skater.py','--','$B/skater_cfg.json'" "$B/build.log"
grep -E "^(weights|body|proxy|uv)" "$B/build_skater.log" || true
npx gltf-transform resample "$B/skater_raw.glb" "$B/skater_rs.glb" > /dev/null
npx gltf-transform prune "$B/skater_rs.glb" "$B/skater_pr.glb" > /dev/null
npx gltf-transform webp "$B/skater_pr.glb" "$B/skater_wp.glb" --quality 90 > /dev/null
npx gltf-transform meshopt "$B/skater_wp.glb" public/models/skater.glb --level medium > /dev/null
ls -la public/models/skater.glb
