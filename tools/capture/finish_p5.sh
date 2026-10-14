#!/usr/bin/env bash
# Pass 5 finish after the second power cut (lead): live check, realtime subset, key mobile suites against the live
# build, focused media. Every browser job takes the heavy lock on its own.   bash tools/capture/finish_p5.sh
set -u
cd /c/Code/skate-park
P5=E:/shots/skate-park/pass-05
LIVE=https://starknightt.github.io/skate-park/
H="bash tools/heavy.sh lead"
T=E:/shots/skate-park/mobile-qa/tools
L=$P5/dev/finish
mkdir -p "$L"
echo "start $(date +%T)"
$H node tools/capture/live_check.mjs --url "$LIVE" --name live_p5 > "$L/live_check.log" 2>&1; echo "live_check $? $(date +%T)"
$H node tools/realtime/rt_protocol.mjs --name final_200 --only flat_side,push,bowl_carve,halfpipe,kickflip > "$L/rt200.log" 2>&1; echo "rt200 $? $(date +%T)"
$H node tools/realtime/rt_protocol.mjs --name final_sweep60 --sweep 60 --only flat_side,kickflip > "$L/rt60.log" 2>&1; echo "rt60 $? $(date +%T)"
export MQA_OUT=$P5/mobile/after_live
$H node $T/load.mjs --url "$LIVE" --runs android4g,iphone4g --out load.json > "$L/m_load.log" 2>&1; echo "m_load $? $(date +%T)"
$H node $T/perf.mjs --url "$LIVE" --suite adaptive --plan iphone:P:4,iphone:L:4,android:P:4,android:L:4 --secs 25 --shot --out perf_adaptive_profiles.json > "$L/m_perf.log" 2>&1; echo "m_perf $? $(date +%T)"
$H node $T/layout.mjs --url "$LIVE" > "$L/m_layout.log" 2>&1; echo "m_layout $? $(date +%T)"
$H node $T/touch.mjs --url "$LIVE" --prof iphone > "$L/m_touch.log" 2>&1; echo "m_touch $? $(date +%T)"
$H node $T/hygiene.mjs --url "$LIVE" --prof iphone > "$L/m_hygiene.log" 2>&1; echo "m_hygiene $? $(date +%T)"
$H node $T/perf.mjs --url "$LIVE" --suite tiers --prof android --q 1 --cpu 4 --out perf_tiers.json > "$L/m_tiers.log" 2>&1; echo "m_tiers $? $(date +%T)"
node $T/protocol.mjs > "$L/m_protocol.log" 2>&1; echo "m_protocol $? $(date +%T)"
unset MQA_OUT
$H bash tools/capture/media5_final.sh A > "$L/media_A.log" 2>&1; echo "media_A $? $(date +%T)"
$H node tools/capture/mobile_touch_clip.mjs --url "$LIVE" --out "$P5" --takes 2 > "$L/media_M.log" 2>&1; echo "media_M $? $(date +%T)"
echo "ALL_DONE $(date +%T)"
