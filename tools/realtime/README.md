# Real-time test protocol (tools/realtime)

Motion and feel reviews are uncapped real-time runs in headed Chrome on the portrait second monitor (DISPLAY2, window at 1930,20; never x < 1920), with real
keyboard and mouse events and one log row per displayed frame. Frame-stepped captures are for stills only. Every browser
run goes through the heavy-job lock. Outputs go under `E:/shots/skate-park/pass-04/realtime/<run>/` by default.

## Commands (run from C:\Code\skate-park)

```bash
# all scenarios, ~2 min (each scenario is dry-run once, then logged): per-frame logs + jitter metric + feel metric (add --record for true-60 fps canvas videos)
bash tools/heavy.sh <you> node tools/realtime/rt_protocol.mjs --name <run>
# a subset
bash tools/heavy.sh <you> node tools/realtime/rt_protocol.mjs --name <run> --only steer,push,kickflip --noexact
# 60 Hz, real time (?fps=60): frame_std is reported as N/A (a 200 Hz rAF grid alternates 15/20 ms by construction)
bash tools/heavy.sh <you> node tools/realtime/rt_protocol.mjs --name <run> --fps 60 --noexact
# controlled sweep: manual clock, simulate + render at exactly 1/R s through the real game path, scripted input
bash tools/heavy.sh <you> node tools/realtime/rt_protocol.mjs --name <run> --sweep 60,120,200

# metrics again on an existing run
python tools/realtime/jitter_metric.py E:/shots/skate-park/pass-04/realtime/<run>/logs/*.json
python tools/realtime/feel_metric.py E:/shots/skate-park/pass-04/realtime/<run>
python tools/realtime/strips_from_run.py E:/shots/skate-park/pass-04/realtime/<run>

# headless physics feel (light, no lock): steering, push, brake, drop-in timelines
node tools/sim/build_src.mjs tools/sim/.build-A2 && node tools/realtime/feel_sim.mjs
# #72 drop-in proof, frame-stepped side-on at deck level (bowl, half pipe, half pipe fakie) + contact strips
bash tools/heavy.sh <you> node tools/capture/run.mjs tools/realtime/dropin_capture.mjs --nohmr --out E:/shots/skate-park/pass-04/feel/dropin
python tools/realtime/dropin_strip.py E:/shots/skate-park/pass-04/feel/dropin
```

Options: `--url` (default `http://127.0.0.1:5188/?test&mute`, the shared dev server; `?test` = Pro controls), `--out`,
`--name`, `--only a,b`, `--record`, `--fps 60`, `--sweep R[,R2]`, `--noexact` (skip the 24 exact 1/200 s frames),
`--nowarm` (skip the default dry run of every scenario before its logged run; content that first comes into view
mid-scenario stalls one frame for ~100-250 ms while its shaders compile).
The page loads with an inert Vite HMR socket, so other helpers' saves don't reload it; a failed load is retried after 20 s.

## Scenarios (keys: real events in real time, the same timeline as scripted input in a sweep)

| Scenario | Setup and input |
|---|---|
| flat_side | 6 m/s, camera side-on |
| flat_behind | 6 m/s |
| steer | 5 m/s: A 0.45 s, D 0.8 s, A 0.45 s |
| push | hold W 3 s from standstill |
| brake | 6 m/s, S 1.2 s |
| bowl_carve | (-28, -2.3, -2) at 7.5 m/s, A/D carves |
| quarter_pipe | (-8, 0, -15.5) at 4.8 m/s, up and back |
| halfpipe | (22.5, 0, -9) at 9.6 m/s, W at 2.6 s |
| kickflip | side-on, hold Space 250 ms, F with no WASD held (kickflip, pops at the current charge); falls back to Space + ArrowLeft if F makes no flip |
| dropin_bowl | east deck of the main bowl at 4.5 m/s, side-on |
| orbit_drag | 300 px drag and back, 150 px vertical |
| mouselook | click the canvas (expects pointer lock), mouse moves, Esc |

## What is logged

`logs/<scenario>.json`: `rows` (one per displayed frame, written at `game.render()` entry, i.e. after every visual
transform of that frame: physics state, board/skater/camera transforms, screen positions of hips/board/head, bone world
transforms, knee bend directions in the skater root frame, steerS, brakeAmt, drop-in phase, pointer lock), `steps` (one
per physics step: wall time, sim time, speed, velocity, heading, steer input and filter, push, brake, pushT), `keys` (real
key events with performance.now()), events. Hooks: `game.simulate`, `game.render`, `physics.step`, `rig.frameGuard`.

## Pass thresholds

`jitter_metric.py` (displayed frames, 1080p px, +-60 ms around impulsive events excluded): frame_std <= 1.0 ms,
hips_rms <= 0.35 px, hips_p99 <= 1.2 px, head_p99 <= 2.0 px, board_rms <= 1.0 mm, flips <= 30/s, hf_share <= 0.25,
stall_frames 0. Residuals are per frame index, so frames longer than 1.5x the median interval are excluded
(+-60 ms) like impulsive events.

`feel_metric.py`: knee-pole change <= 6 deg per displayed frame (bails excluded); steering 90 % of the turn rate in
120-200 ms, no overshoot, radius >= 3 m at 5 m/s; push key -> first acceleration <= 120 ms, peak <= 7.5 m/s^2, no
acceleration step > 3 m/s^2 between physics steps; brake ramp; no frozen deck frames during a flip.
