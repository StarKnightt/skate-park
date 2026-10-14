#!/usr/bin/env bash
# Pass 5 lead: production build + preview (base /skate-park/ on 5189), the full mobile protocol against it, and the
# realtime subset on the dev server (desktop ?test = tier 2). Every browser job takes the heavy lock on its own.
#   bash tools/capture/final_protocols.sh [tag]      (tag default: after_local)
set -u
cd /c/Code/skate-park
TAG="${1:-after_local}"
P5=E:/shots/skate-park/pass-05
mkdir -p "$P5/dev"
bash tools/heavy.sh lead pnpm build > "$P5/dev/build_$TAG.log" 2>&1 || { echo "build failed"; tail -20 "$P5/dev/build_$TAG.log"; exit 1; }
if [ -f "$P5/dev/preview.pid" ]; then kill "$(cat "$P5/dev/preview.pid")" 2>/dev/null; fi
nohup pnpm exec vite preview --port 5189 > "$P5/dev/preview.log" 2>&1 &
echo $! > "$P5/dev/preview.pid"
for i in 1 2 3 4 5 6 7 8 9 10; do curl -sf -o /dev/null http://127.0.0.1:5189/skate-park/ && break; sleep 1; done
echo "preview up $(date +%T)"
( MQA_OUT="$P5/mobile/$TAG" bash tools/mobile-qa/run_all.sh http://127.0.0.1:5189/skate-park/ > "$P5/mobile/run_all_$TAG.log" 2>&1; echo "run_all done $(date +%T)" >> "$P5/mobile/run_all_$TAG.log" ) &
sleep 20
bash tools/heavy.sh lead node tools/realtime/rt_protocol.mjs --name final_200 --only flat_side,push,bowl_carve,halfpipe,kickflip > "$P5/realtime/final_200.log" 2>&1
bash tools/heavy.sh lead node tools/realtime/rt_protocol.mjs --name final_sweep60 --sweep 60 --only flat_side,kickflip > "$P5/realtime/final_sweep60.log" 2>&1
echo "realtime done $(date +%T)"
wait
echo "all done $(date +%T)"
