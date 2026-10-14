# Testing

The game was checked by tools rather than by eye wherever a number could settle the question: a test API built into
the game, a frame-stepped capture harness for stills, a real-time protocol for motion, a mobile protocol for phones,
and headless simulations of the physics and the autopilot. This document describes each, its pass thresholds, its last
results, and how to run it again. [MAKING-OF.md](MAKING-OF.md) tells the story of how they were used.

The tools were written for the author's Windows PC, and a few assumptions are built in:

- they drive the installed Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` through `playwright-core`
  (a devDependency); the mobile suites also read `CHROME_PATH`;
- headed windows open on the portrait second monitor, at x = 1930 or further right (never on the main screen), and fit
  inside 1080 by 1862; everything else runs headless;
- outputs go under `E:/shots/skate-park/` unless an option says otherwise; screenshots and recordings are never
  written into the repository;
- the metrics and strip makers are Python 3 with NumPy, SciPy and Pillow, and the encoders call ffmpeg.

## The heavy-job lock

```
bash tools/heavy.sh <owner> <command...>
```

Every browser run, Blender job, production build and ffmpeg encode goes through `tools/heavy.sh`, so only one runs at
a time on the machine. The lock is a directory, `.agent-notes/heavy.lock` in the repository (git ignores the folder),
holding an `owner` file that records who took it, when and for what. Others wait, checking every 8 s; a lock older
than 25 minutes is treated as stale and broken; the lock is released when the command exits, even on failure. The
headless simulations are light and skip it.

The reason is measurement, not tidiness: two browsers rendering on one GPU each run at half speed, and the frame
times in the report then measure the other job. The lock has no queue: whoever checks first after a release gets it,
so a helper that runs jobs back to back can make others wait.

## The test API

Load the game with `?test` (or `?debug`) and it exposes `window.__skate` (`src/debug/testHooks.ts`):

| Call | Does |
|---|---|
| `ready` | true once the game is playable (under the test flags, once the crowd has loaded too) |
| `teleport(x, y, z, headingDeg, speed)` | respawn at a spot, facing a heading, at a speed; returns the state |
| `setTime(nameOrIndex, instant)` | the time of day by index (0 golden hour, 1 sunset, 2 blue hour, 3 bright noon) |
| `script(steps)` | a key timeline, `[{ at, down: [codes], up: [codes] }]` in simulation seconds |
| `hold(codes)`, `release(codes)` | hold or release key codes (`KeyW`, `Space`, `KeyF` and so on); `release()` lets go of all |
| `manual(true)` | takes the game loop off the wall clock |
| `advance(frames, dt, render)` | runs input and simulation for each frame at `dt` (default 1/30 s), then renders once |
| `shot(name)` | moves the camera to a named landmark (with no match it returns the names) |
| `view(px, py, pz, lx, ly, lz)` | a fixed camera; `view()` with no arguments returns the interpolated state the last frame drew |
| `free()`, `orbit(speed, dist, h)`, `camYaw(rad, pitch)`, `camDist(d)`, `snapCam()` | camera control |
| `frame()` | the last frame's physics steps, leftover time and interpolation fraction |
| `look(dx, dy)` | raw mouse-look counts, as with the pointer locked |
| `pause(on)` | pauses even under the manual clock |
| `hud(on)`, `touch(on)` | hides the HUD, shows the touch controls |
| `state()` | the physics: mode, position, velocity, speed, normal, fakie, air time, grind, manual, flip, the skater's phase, time, time of day, quality level |
| `events()` | the physics events since the last call (pops, landings with their quality, grinds, bails…) |
| `feetError()` | the distance from each sole to the deck |
| `input`, `game` | the live input and game objects |

Under these flags saved settings are ignored and nothing is saved, the control mode starts on Pro (`?mode=` changes
it), there is no start screen (`&attract` brings it back), the adaptive quality is off, and the game never pauses
itself while the manual clock runs. `?test` also exposes `window.__pauseMenu` (`open()`, `close()`, `isOpen`,
`page(p)`, `controls(device, mode)`).

## Frame-stepped capture

```
pnpm dev                                    # the dev server on 127.0.0.1:5188, in another terminal
bash tools/heavy.sh me pnpm capture tools/capture/smoke.mjs --nohmr --out E:/shots/skate-park/check
```

`tools/capture/run.mjs` (also `pnpm capture`) opens headed Chrome on the second monitor with an emulated viewport
(1280 by 720 by default, `--w`/`--h`, `--mobile` for a phone profile), loads the game with `?test&fps=30&mute` (change
it with `--q`), waits for `ready`, and calls the scenario module's default export with a small context: `api(method,
...args)` calls the test API, `shot(name)` saves a screenshot under `--out`, and `record(name, frames, step)` saves a
frame-stepped sequence. `--nohmr` gives the page an inert Vite hot-reload socket, so someone else's save can't reload
it mid-capture. Console errors are written to `console.log` in the output folder.

Scenarios switch to the manual clock and advance exactly 1/30 s per frame, so the same input gives the same frames on
any machine, at any speed. Every critic's media set was made this way: `tools/capture/media.mjs` grew into
`media2.mjs`, `media3.mjs` and `media4.mjs`, with `encode.py`, `sheet.py` and `make_index*.py` turning the frames into
clips, contact sheets and an index.

**Frame-stepped captures are for stills only.** At 1/30 s every frame runs exactly four physics steps, so the beat
between 120 Hz physics and a faster display can never appear in them. That is how the skater's vibration stayed
hidden through two reviews. Motion is judged only by the real-time protocol below.

## The real-time protocol

`tools/realtime/` holds the protocol the diagnosis designed after the user reported the vibration (its README has the
details). It runs against the dev server:

```
bash tools/heavy.sh me node tools/realtime/rt_protocol.mjs --name <run>                  # every scenario, real time
bash tools/heavy.sh me node tools/realtime/rt_protocol.mjs --name <run> --only flat_side,kickflip
bash tools/heavy.sh me node tools/realtime/rt_protocol.mjs --name <run> --sweep 60       # exact 1/60 s steps
python tools/realtime/jitter_metric.py E:/shots/skate-park/pass-05/realtime/<run>/logs/*.json
python tools/realtime/feel_metric.py E:/shots/skate-park/pass-05/realtime/<run>
python tools/realtime/strips_from_run.py E:/shots/skate-park/pass-05/realtime/<run>
```

It opens headed Chrome on the second monitor (an 880 by 640 window), loads `?test&mute`, and plays each scenario with
real keyboard and mouse events in real time, uncapped, so the frame rate is the monitor's. On the development PC that
is 200 Hz, and the harness checks that the median frame interval is 5.00 ms. Each scenario first runs once unlogged to
warm the shaders, then once logged. The log has one row per displayed frame, written as `render()` starts, after every
visual transform: the physics state, the board, skater and camera transforms, the screen positions of the hips, board
and head, bone positions, the knees' bend directions, the filtered steering, the brake and the drop-in phase. A
second log has one row per physics step, and a third the real key events. `--record` adds 60 fps canvas recordings,
`--fps 60` caps the game at 60, and `--sweep 60,120,200` replaces real time with a manual clock at exactly 1/R s
through the same game path, with the same key timeline. Outputs go to `E:/shots/skate-park/pass-05/realtime/<run>/`
(`--out` to change).

| Scenario | Setup and input |
|---|---|
| flat_side | 6 m/s on flat ground, camera side-on |
| flat_behind | 6 m/s, camera behind |
| steer | 5 m/s: A for 0.45 s, D for 0.8 s, A for 0.45 s |
| push | hold W for 3 s from a standstill |
| brake | 6 m/s, S for 1.2 s |
| bowl_carve | into the main bowl at 7.5 m/s, with A and D carves |
| quarter_pipe | at 4.8 m/s up a quarter pipe and back |
| halfpipe | into the half pipe at 9.6 m/s, W from 2.6 s |
| kickflip | side-on, Space held 250 ms, then F with no direction key |
| dropin_bowl | from the main bowl's east deck at 4.5 m/s, side-on |
| orbit_drag | a 300 px mouse drag and back, then 150 px vertically |
| mouselook | click to lock, mouse moves, Esc |

**Jitter metric** (`jitter_metric.py`). On the displayed frames, the hips' screen position is high-pass filtered (the
residual after a zero-phase second-order Butterworth low-pass at 8 Hz) and measured in pixels of a 1080-pixel-tall
view. 60 ms either side of impulsive events (a mode change, a velocity change over 0.8 m/s in one frame) and of long
frames (over 1.5 times the median) is left out. A scenario passes only if every value is within its threshold:

| Metric | Pass if at most |
|---|---|
| Frame interval standard deviation | 1.0 ms (reported as not applicable in capped runs) |
| Hips residual, RMS | 0.35 px |
| Hips residual, 99th percentile | 1.2 px |
| Head residual, 99th percentile | 2.0 px |
| Board position residual, RMS | 1.0 mm |
| Direction flips of the hips' second difference | 30 a second |
| Share of the hips' screen velocity above 10 Hz | 0.25 |
| Stalled frames (the board moving under 5 % of the expected distance above 1 m/s) | 0 |

**Feel metric** (`feel_metric.py`): the knees' bend direction changes by at most 6° per displayed frame at 200 Hz
(bails excluded); steering reaches 90 % of its turn rate in 120 to 200 ms with under 3 % overshoot, and the turn radius
is at least 3 m at 5 m/s; a push accelerates within 120 ms of the key, peaks at no more than 7.5 m/s² and never
changes its acceleration by more than 3 m/s² between physics steps; the brake ramps in; during a flip the deck turns
on every frame (no frozen frames).

**Results.** The "before" column is the diagnosis's baseline on the build the user played; the "after" column is the
latest run of each scenario.

| Scenario | Before: hips RMS / p99 px, board mm, flips/s | After | Result |
|---|---|---|---|
| flat_side | 3.04 / 4.56, 13.3, 160 | 0.01 / 0.03, 0.25, 0 | PASS |
| flat_behind | 0.54 / 0.99, 13.4, 160 | 0.00 / 0.01, 0.23, 0 | PASS |
| steer | 1.26 / 3.00, 11.2, 160 | 0.04 / 0.19, 0.23, 2 | PASS |
| push | 0.48 / 1.13, 9.0, 145 | 0.16 / 0.55, 0.13, 4 | PASS |
| bowl_carve | 2.07 / 4.13, 12.5, 159 | 0.24 / 1.04, 0.48, 5 | PASS |
| quarter_pipe | 1.61 / 3.24, 8.0, 136 | 0.28 / 1.10, 0.63, 4 | PASS |
| halfpipe | 3.63 / 7.37, 13.8, 158 | 0.31 / 0.95, 0.65, 26 | PASS |
| kickflip | 2.76 / 5.16, 11.1, 160 | 0.31 / 1.11, 0.50, 5 | PASS |
| dropin_bowl | | 0.31 / 0.92, 0.85, 8 | PASS |
| brake | | 0.01 / 0.01, 0.18, 0 | PASS |
| orbit_drag | | 0.08 / 0.32, 0.16, 10 | PASS |
| mouselook | | 0.06 / 0.19, head 0.28 | PASS |

The after values come from the pass-5 runs `final_200` and `final_200b` (flat_side, push, bowl_carve, halfpipe,
kickflip, dropin_bowl, steer, brake), `c-cam_check` (quarter_pipe, orbit_drag) and `m-perf_check2` (mouselook, at
15:05); flat_behind's numbers are from pass 4's final run, and it passed again in `m-perf_check2`. In the 60 Hz sweep,
flat_side measured 0.00 / 0.01 px and kickflip 0.26 / 0.80 px. The extra checks: knees at most 5.7° per frame (the
kickflip), steering at 90 % in 127 to 132 ms with at most 0.7 % overshoot, the push answering in 95.7 ms and peaking at
6.67 m/s² with steps of 0.5, the brake ramping in 141 ms, and 0 frozen frames out of 55 during the flip.

**Never run `mouselook` with a real pointer lock while someone is using the machine.** The test window never has the
focus, but once in pass 5 Chrome granted it a real lock anyway, and the user's own mouse movements came through (that
run was discarded). `tools/realtime/media_protocol.mjs` is the same protocol with the Pointer Lock API emulated inside
the page (`emulateLock` in `media_common.mjs`): the game's own lock path still runs, and Esc is consumed the way the
browser would. Use it for recordings.

## The mobile protocol

`tools/mobile-qa/` holds the QA agent's suites, copied into the repository with their paths made relative to it. They
are read-only against the game and run headless: the real Chrome with the hardware GPU, no window, no focus change.
Each suite emulates the device (viewport, device pixel ratio, mobile flag, five touch points, user agent, safe-area
insets), throttles the CPU through the DevTools protocol, emulates Fast 4G (8.1 Mbps, 165 ms) or Slow 4G (1.44 Mbps,
563 ms), and delivers the page's animation frames on a 60 Hz grid, so a frame that overruns 16.7 ms waits for the next
refresh as it would on a phone. Touches are real multi-finger events (`Input.dispatchTouchEvent`).

```
bash tools/mobile-qa/run_all.sh                                       # every suite against the live site (~25 min)
MQA_OUT=E:/shots/skate-park/mobile-qa/<run> bash tools/mobile-qa/run_all.sh http://127.0.0.1:5189/skate-park/
MQA_OUT=E:/shots/skate-park/mobile-qa/<run> node tools/mobile-qa/protocol.mjs   # the PASS / FAIL table
bash tools/heavy.sh mobileqa node tools/mobile-qa/touch.mjs --url <url> --prof iphone   # one suite
```

The second line tests a local `pnpm build` served by `pnpm preview`. Each browser suite takes the heavy-job lock on its
own, so other jobs can run between suites. Results go to `$MQA_OUT/data` and `$MQA_OUT/shots`; the default is
`E:/shots/skate-park/mobile-qa/rerun`, which leaves the original report's data untouched. Add `--headed` to a suite to
watch it on the second monitor.

| Suite | What it does |
|---|---|
| `static.mjs` | no browser: transfer sizes per encoding, cache headers, GLB contents, WebP sizes, sound lengths and decoded PCM |
| `load.mjs` | warms the CDN, then cold loads on Fast 4G with 4x CPU (Android and iPhone profiles) and Slow 4G with 6x: first paint, first WebGL draw, playable time, the progress bar's timeline, requests; the first real tap times the audio |
| `perf.mjs --suite adaptive` | the real build with auto-ride on, CPU throttled, 60 Hz: fps, frames over 20 ms, main-thread time per frame, the pixel ratio the adaptation chose, heap |
| `perf.mjs --suite tiers` | `?test&quality=0/1/2`: draw calls, triangles and CPU time per subsystem at 4x, and a screenshot per level |
| `scene.mjs`, `profile.mjs` | the node, mesh and bone census; an 8 s CPU profile at 4x |
| `layout.mjs` | 12 viewports (four phones and tablets, plus the visible areas left by Safari's and Chrome's bars, in both orientations): tap target sizes, text sizes, overlaps, safe areas, the pause menu and help |
| `touch.mjs` | 14 multi-touch cases (T1 to T14): the stick, near misses, three fingers at once, swipe flips, drift and slide-off, a cancelled touch, the pause menu, auto-ride takeover, drags across buttons, pinch, rotation, a first run |
| `hygiene.mjs` | 7 checks (H1 to H7): the manifest and meta tags, long-press, scrolling, pausing when hidden, WebGL context loss and restore, fullscreen, the toast's position |
| `protocol.mjs` | no browser: evaluates the thresholds below from the JSON results |
| `probe.mjs`, `debug_multitouch.mjs` | the environment probe, and the proof of the touch event semantics |

| # | Check | Threshold | Before (live, pass 4) | After (helpers' builds, pass 5) |
|---|---|---|---|---|
| P1 | Playable on Fast 4G with 4x CPU (Android / iPhone) | under 8 s | 8.34 / 8.49 s | 5.57 / 5.34 s |
| P1 | Playable on Slow 4G with 6x CPU | under 20 s | 28.7 s | 18.05 s |
| P1 | Transfer before playable | under 2.5 MB | 3.31 MB | 2.39 MB |
| P1 | Every sound decoded after the first tap (Fast 4G) | under 3 s | 6.4 to 18.7 s | 1.37 to 1.39 s |
| P2 | Mean fps at 4x CPU, 60 Hz, every profile | at least 50 | Android 44.9 to 52.1 | 58.5 to 59.9 |
| P2 | Frames over 20 ms at 4x | at most 10 % | Android 15 to 31 % | 0.1 to 2.4 % |
| P2 | Main-thread time per frame at 4x, 95th percentile | at most 14 ms | 14.5 to 22.8 ms | 9.7 to 13.1 ms |
| P2 | Render scale on phones | never below 1.0 | 0.85 in 5 of 8 runs | 1.25 throughout |
| P2 | Mean fps at 6x CPU | at least 40 | 29.3 | 46.3 |
| P3 | Medium: draw calls / triangles / render submission at 4x | 150 / 600,000 / 7 ms | 207 / 1.32 M / 11.9 ms | 105 / 561,000 / 4.6 to 5.8 ms |
| P4 | Tap targets (HUD and pause menu) | at least 44 px | 18 menu controls and the pills below | none below |
| P5 | Overlaps, safe areas, text size over 12 viewports | none, none, at least 12 px | failing | passing |
| P6 | Multi-touch T1 to T14 | all PASS | 10 PASS, 1 FAIL, 3 NOTE | 14 of 14 |
| P7 | Hygiene H1 to H7 | all PASS | H1, H4 and H7 failing | 7 of 7 |
| P8 | Decoded audio / GPU memory estimate / JS heap | 40 / 120 / 120 MB | 98.1 / 139 / 99.7 MB | 21.7 / 114 / 78.7 MB |

The protocol stood at 32 PASS, 40 FAIL and 4 not applicable on the live pass-4 build, and at 62 PASS and 0 FAIL on the
rows the pass-5 helpers measured on their builds of the final code. The full suite was not rerun on the final build:
the run started at 15:31 died in the second power cut, and the rerun was put off. On the live final build only the
load suite ran: playable in 4.6 s (Android profile) and 6.1 s (iPhone profile) after 1.86 MB, with every sound decoded
1.4 to 1.5 s after the first tap. Running `protocol.mjs` from `tools/mobile-qa/` on a copy of the original report's data
reproduces its 32 PASS, 40 FAIL and 4 not applicable.

Things to know when rerunning it:

- In Chrome's DevTools protocol, `touchEnd` releases the points it lists; listing the fingers that stay down lifts those
  instead (`debug_multitouch.mjs` proves it). `touchCancel` takes no points.
- Playwright's `page.evaluate` counts as a user gesture, so an audio unlock check must not call it before the first
  real tap; `load.mjs` reads its progress from console markers instead.
- The WebGL call hooks that count draw calls cost about 6 ms a frame at 4x, so the fps runs leave them off.
- CPU throttling slows only the page's main thread, and GPU timings from a desktop card are relative at best.
- Runs at 4x spread by about 4 fps; judge P2 on at least two runs per profile.
- No emulator covers the iPhone's audio rules, a phone's GPU and shader compile times, the wake lock, pinch on iOS or
  thermal throttling; those still need a real device.

## Headless simulations

```
node tools/sim/build_src.mjs tools/sim/.build-d          # transpile src/ to plain ES modules
node tools/sim/recovery_sim.mjs 400                       # recovery_sim reads tools/sim/.build-d unless SIMB is set
SIMB=./.build-me/ node tools/sim/assist_sim.mjs           # SIMB is relative to tools/sim/
```

`build_src.mjs` transpiles every file in `src/` with the TypeScript compiler into a folder of plain ES modules, so the
real physics, recovery planner, input layer, autopilot and camera rig run in Node against the real park collision,
with no browser and no GPU. Give each concurrent user their own folder (git ignores `tools/sim/.build*`); the sims
pick their build folder from the `SIMB` environment variable where they support it, and their header comments give
the exact command. They are light jobs and skip the heavy-job lock.

| Sim | What it checks | Last result |
|---|---|---|
| `tools/sim/recovery_sim.mjs [n] [fast]` | bails at every kind of feature plus n random spots: the body comes to rest on level ground, the board rests sensibly, the ride-away spot is reachable | 483 of 483, Pro and fast recovery |
| `tools/sim/assist_sim.mjs` | Easy's assists: auto-grind only on approaches along a line, the landing assist, Pro's bails unchanged | 21 of 21 |
| `tools/sim/respawn_audit.mjs` | the spawn and the landmark teleports are flat, open ground with the board under him | passing |
| `tools/sim/board_rail_sim.mjs` | 230 bails: the board never sleeps balanced on its rail and never moves toward him once it has stopped | 0 and 0 |
| `tools/sim/board_sim.mjs` | the bail board separates, travels 1 to 2 m and comes to rest on the ground | |
| `tools/sim/quickpop_sim.mjs` | the rolling F quick pop through the real input layer: the crouch before it, the charge, the air time | a 92 ms crouch and 0.533 s of air, clean |
| `tools/sim/auto_sim.mjs` | autopilot laps (`--laps`, `--seeds`, `--pro`, `--attract`): no bail, no stall over 3 s, never out of the park, and what each lap covered | 9 of 9 per mode after the last physics change; 27 of 27 per mode in pass 4 |
| `tools/sim/auto_reacquire.mjs` | 30 random flat starts: the autopilot finds its way back onto the lap | 29 of 30 and 26 of 30, a median of 2.1 to 2.6 s |
| `tools/sim/auto_hpexit.mjs` | 72 starts at the half-pipe hand-back: the exit carve meets the mini quarter pipe | 72 of 72, 0 bails |
| `tools/sim/auto_hp_probe.mjs` | half-pipe pumping without the autopilot | the lip on pass 6 from a push start |
| `tools/sim/cam_wall_sim.mjs` | the camera through auto-ride laps: frames with his head or board out of shot, boom jumps | head out 461 to 132 frames, board out 186 to 0 |
| `tools/sim/wall_probe.mjs` | the bowl carve's hold on the wall top and the swing onto the lip | the level stretch 1.03 to 0.62 s |
| `tools/realtime/feel_sim.mjs` | steering, push, brake and drop-in timelines | |
| `tools/realtime/batch2_sim.mjs` | forward and fakie kickturns, half-pipe pumping, drop-ins | |
| `tools/capture/media4_sim.mjs` | replays the media set's key timelines headless | |

`tools/sim/ground_scan.mjs` prints the ground profile along a line, `auto_diag.mjs` logs the autopilot's state changes,
and `clip_tracks.mjs` prints the hips' motion per clip of a raw skater GLB (from the character build, not in the
repository). The browser counterparts run through the capture harness: `auto_browser.mjs`, `auto_final2.mjs`,
`recovery_browser.mjs` and `recovery_b2_browser.mjs` in `tools/sim/`, and `input_check.mjs` and `ui_check.mjs` in
`tools/capture/`. `tools/assets/audio_verify.mjs` checks the audio graph headless (22 of 22 in pass 5).

## Live check

```
bash tools/heavy.sh me node tools/capture/live_check.mjs --name <n>    # [--url ...] [--out ...]
```

`tools/capture/live_check.mjs` loads the deployed site (or any `--url`) at 1280 by 720 in headed Chrome on the second
monitor, plays a few seconds with real keys, opens and closes the pause menu, and reports the load time, console errors,
failed requests, the stored control mode and the HUD text, with screenshots. The last run on the final build: a 6.5 s
load, 0 console errors, 0 failed requests, Easy as the default, and the menu opening and closing.

## Rerunning everything

1. `pnpm typecheck` and `bash tools/heavy.sh me pnpm build`.
2. The headless sims (light, any time).
3. `pnpm dev`, then the real-time protocol, at least `flat_side,push,bowl_carve,halfpipe,kickflip` at 200 Hz and
   `flat_side,kickflip` in a 60 Hz sweep.
4. `pnpm preview` on the build, then `tools/mobile-qa/run_all.sh` against `http://127.0.0.1:5189/skate-park/` with
   its own `MQA_OUT`.
5. After a deploy, `live_check.mjs` against the live site.

`tools/capture/final_protocols.sh` and `tools/capture/finish_p5.sh` chain these steps the way pass 5 ran them, writing
under `E:/shots/skate-park/pass-05/`.
