#!/usr/bin/env bash
# Rebuild public/audio from the untouched original sound files (the CC0 freesound downloads credited in README):
# every file trimmed to the slices src/audio/audio.ts plays, re-encoded (mono except the anti-phase waves), music copied.
# The originals live OUTSIDE the repo (public/audio is the output); the slice table + method are in audio_trim.mjs.
#   bash tools/heavy.sh <you> bash tools/assets/audio_trim.sh [origDir] [outDir]
# then: node tools/assets/audio_trim.mjs check <origDir> <outDir>   (seams, slice alignment vs the originals, sizes, PCM)
set -euo pipefail
cd "$(dirname "$0")/../.."
ORIG="${1:-E:/shots/skate-park/pass-05/dev/m-audio/orig}"
OUT="${2:-public/audio}"
command -v ffmpeg >/dev/null || { echo "ffmpeg not found"; exit 1; }
for f in roll_concrete roll_wood waves grind_metal grind_concrete pop land clack bail_thud seagulls music; do
  [ -f "$ORIG/$f.mp3" ] || { echo "missing original $ORIG/$f.mp3"; exit 1; }
done
node tools/assets/audio_trim.mjs build "$ORIG" "$OUT"
