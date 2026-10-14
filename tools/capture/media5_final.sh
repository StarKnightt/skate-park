#!/usr/bin/env bash
# Pass-5 media finals (helper media), run on the frozen code. Each part list should hold the heavy lock < 5 min:
#   bash tools/heavy.sh media bash tools/capture/media5_final.sh A M     frame-stepped stills + first frame, mobile touch clip
#   bash tools/heavy.sh media bash tools/capture/media5_final.sh B R     real-time flips + bowl carve, auto-ride lap excerpt
#   bash tools/heavy.sh media bash tools/capture/media5_final.sh L       mobile touch clip, landscape (optional)
# Stills land in dev/media/final/{fs,first}/screens (the 8 regression names are copied to screens/ afterwards).
set -u
cd /c/Code/skate-park
P=E:/shots/skate-park/pass-05
W=$P/dev/media/final
mkdir -p "$W"
murl() { if curl -sf -o /dev/null http://127.0.0.1:5189/skate-park/; then echo http://127.0.0.1:5189/skate-park/; else echo http://127.0.0.1:5188/; fi; }
for part in "$@"; do
  echo "[media5_final] $part start $(date +%T)"
  case "$part" in
  A)
    ONLY=close,chars,wide,tod VIEWS=c_bowl_main node tools/capture/run.mjs tools/capture/media4.mjs --nohmr --out "$W/fs" --log "$W/fs/console.log" > "$W/fs_stills.log" 2>&1
    node tools/capture/run.mjs tools/capture/media2_first.mjs --nohmr --q 'test&fps=30' --out "$W/first" --log "$W/first/console.log" > "$W/first.log" 2>&1 ;;
  M)
    U=$(murl); echo "mobile url $U" > "$W/mobile_portrait.log"
    node tools/capture/mobile_touch_clip.mjs --url "$U" --out "$P" --takes 3 >> "$W/mobile_portrait.log" 2>&1 ;;
  L)
    U=$(murl); echo "mobile url $U" > "$W/mobile_landscape.log"
    node tools/capture/mobile_touch_clip.mjs --url "$U" --out "$P" --land --takes 2 >> "$W/mobile_landscape.log" 2>&1 ;;
  B)
    node tools/capture/rt_clips.mjs --only f_flips > "$W/rt_flips.log" 2>&1
    ffmpeg -hide_banner -loglevel error -y -i "$P/clips/rt_feat_f_flips.mp4" -vf setpts=4*PTS -r 60 -c:v libx264 -preset medium -crf 16 \
      -pix_fmt yuv420p -threads 4 -movflags +faststart "$P/clips/rt_feat_f_flips_quarter.mp4" >> "$W/rt_flips.log" 2>&1
    rm -rf "$P/realtime/media_rec"
    node tools/realtime/media_protocol.mjs --name media_rec --only bowl_carve --record > "$W/rt_bowl.log" 2>&1
    python tools/realtime/strips_from_run.py "$P/realtime/media_rec" > "$W/rt_strips.log" 2>&1
    python tools/realtime/media_post.py "$P/realtime/media_rec" > "$W/rt_post.log" 2>&1 ;;
  R)
    HANDOFF=0 ATTRACT_SECS=0 LAP_SECS=84 node tools/capture/run.mjs tools/sim/auto_final2.mjs --nohmr --q 'test&mute&mode=auto' --out "$P/autoride" --log "$P/autoride/console.log" > "$W/autoride.log" 2>&1
    python tools/capture/media5_autoride_excerpt.py "$P/autoride" "$P/clips/clip50_autoride_lap_excerpt.mp4" "$P/sheets/clip50_autoride_lap_excerpt.jpg" > "$W/excerpt.log" 2>&1 ;;
  esac
  echo "[media5_final] $part done $(date +%T)"
done
