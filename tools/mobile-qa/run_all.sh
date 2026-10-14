#!/usr/bin/env bash
# Repeatable mobile QA protocol for Golden Hour Skatepark. Read-only against the game; writes only under $MQA_OUT/{data,shots}
# (default in common.mjs). Every browser suite takes the machine-wide heavy-job lock on its own, so other jobs can interleave
# between suites. Browsers run headless (no window, no focus change).
#   bash tools/mobile-qa/run_all.sh [URL]                                   # default: the live GitHub Pages build
#   MQA_OUT=E:/shots/skate-park/mobile-qa/<run> bash tools/mobile-qa/run_all.sh http://127.0.0.1:5189/skate-park/   # local `pnpm preview`
# ~25 min of browser time in total (load 4, perf 9, tiers 2, layout 3.5, touch 1.2, hygiene 2, scene/profile 1.5).
set -u
T="$(cd "$(dirname "$0")" && pwd)"
URL="${1:-https://starknightt.github.io/skate-park/}"
H="bash $T/../heavy.sh mobileqa"
cd "$T"
node static.mjs --url "$URL"                                                               # asset audit, no browser
$H node load.mjs --url "$URL" --runs android4g,iphone4g,androidSlow --out load.json         # Fast 4G / Slow 4G cold loads
$H node perf.mjs --url "$URL" --suite adaptive --plan android:P:1,android:P:4,android:P:6 --secs 30 --shot --out perf_adaptive_sweep.json
$H node perf.mjs --url "$URL" --suite adaptive --plan iphone:P:4,iphone:L:4,small:P:4,ipad:P:4,ipad:L:4 --secs 25 --shot --out perf_adaptive_profiles.json
$H node perf.mjs --url "$URL" --suite tiers --prof android --q 0,1,2 --cpu 4 --out perf_tiers.json
$H node scene.mjs --url "$URL"
$H node profile.mjs --url "$URL" --q 1 --secs 8
$H node layout.mjs --url "$URL"
$H node touch.mjs --url "$URL" --prof iphone
$H node hygiene.mjs --url "$URL" --prof iphone
node protocol.mjs
