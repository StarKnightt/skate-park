"""Pass-5 media manifest (helper media): E:/shots/skate-park/pass-05/m_manifest.md from the run outputs + a notes file.

usage: python media5_manifest.py [NOTES.json]   (default <pass-05>/dev/media/final/notes.json)
  notes: {"stills": {name: "difference from pass-04"}, "build": "...", "mobile_src": "...", "extra": ["line", ...], "missing": ["line", ...]}
"""
import glob
import json
import os
import subprocess
import sys

P = os.environ.get('MEDIA_OUT', 'E:/shots/skate-park/pass-05')
NOTES = sys.argv[1] if len(sys.argv) > 1 else os.path.join(P, 'dev', 'media', 'final', 'notes.json')
N = json.load(open(NOTES, encoding='utf8')) if os.path.exists(NOTES) else {}
J = lambda p: json.load(open(p, encoding='utf8')) if os.path.exists(p) else {}


def probe(f):
    o = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', f],
                       capture_output=True, text=True).stdout
    try:
        j = json.loads(o)
        s = j['streams'][0]
        a, b = s['r_frame_rate'].split('/')
        return f"{s['width']}x{s['height']}, {float(a) / float(b):.0f} fps CFR, {float(j['format']['duration']):.2f} s"
    except Exception:
        return 'probe failed'


def rel(f):
    return os.path.relpath(f, P).replace('\\', '/')


def exists(f):
    return os.path.exists(os.path.join(P, f))


L = ['# Skate park media - pass-05, helper "media" manifest', '']
L += [N.get('build', 'Build: the frozen pass-5 code (code freeze 15:45 IST).'), '']
L += ['A focused set, not the full regression set: the same tools, names and cameras as pass 4 (`pass-04/index.md`, `pass-04/m1_manifest.md`,',
      '`pass-04/m2_manifest.md`). Desktop media: `?test` on the dev server http://127.0.0.1:5188/ (tier 2, as pass 4), headed Chrome on the second',
      'monitor only. Mobile clip: headless Chrome. Every browser run and encode went through `tools/heavy.sh media`.', '']

# ------------------------------------------------------------------ 1. stills
cmp = J(os.path.join(P, 'screens', 'cmp', 'compare.json'))
DESC = {
    'a_first_frame_golden': 'first frame after load in real time (`media2_first.mjs`, `?test&fps=30`, sound prompt on), golden hour, HUD as the player sees it',
    'e_golden_hour_wide': 'golden hour, wide over the park', 'e_sunset_wide': 'sunset, wide over the park',
    'e_blue_hour_lamps_wide': 'blue hour: lamps along the west side, warm pools, lit windows', 'e_bright_noon_wide': 'bright noon, wide over the park',
    'b_face_neutral': 'face close-up while rolling, neutral expression', 'b_5050': '50-50 on the long ledge, follow camera',
    'c_bowl_main': 'main bowl from the deck: wall gradients, coping, tile band',
}
L += ['## 1. Frame-stepped regression stills (`screens/`, `screens/cmp/`)', '',
      'Made with `tools/capture/media4.mjs` groups `close`, `chars`, `wide` (only `c_bowl_main`) and `tod`: `?test&fps=30&mute`, 1280x720 PNG, deterministic',
      '30 fps frame stepping, pass-04 recipes and cameras. `a_first_frame_golden` runs in real time with `media2_first.mjs`. Compare composites:',
      '`tools/capture/media5_compare.py` (pass-04 | pass-05 | |difference| x4; mean absolute RGB difference in 8-bit levels, share of pixels off by',
      'more than 8 and 32 levels). Palms, walkers, sea and clouds animate on game time, and a frame-stepped session starts its manual clock after',
      'a load-dependent stretch of real time, so palm fronds and walkers never line up exactly with pass 4; read the x4 panel for the rest.', '']
for n in ['a_first_frame_golden', 'e_golden_hour_wide', 'e_sunset_wide', 'e_blue_hour_lamps_wide', 'e_bright_noon_wide', 'b_face_neutral', 'b_5050', 'c_bowl_main']:
    if not exists(f'screens/{n}.png'):
        L.append(f'- `screens/{n}.png` - MISSING')
        continue
    r = cmp.get(n, {})
    num = f"mean |diff| {r['mean_abs_diff_255']:.2f}/255, {100 * r['share_px_gt8']:.1f} % of pixels > 8/255" if r else 'no compare'
    L.append(f"- `screens/{n}.png` - {DESC[n]}. vs pass-04: {num}. {N.get('stills', {}).get(n, '')}".rstrip())
for n in ['a_first_frame_golden', 'e_golden_hour_wide', 'e_sunset_wide', 'e_blue_hour_lamps_wide', 'e_bright_noon_wide', 'b_face_neutral', 'b_5050', 'c_bowl_main']:
    if exists(f'screens/cmp/{n}_p04_vs_p05.jpg'):
        L.append(f'- `screens/cmp/{n}_p04_vs_p05.jpg` - pass-04 | pass-05 | |difference| x4 of `{n}`, numbers in the header')
if exists('screens/cmp/compare.json'):
    L.append('- `screens/cmp/compare.json` - the numbers above (mean |diff| /255, share of pixels > 8 and > 32 levels)')
L.append('')

# ------------------------------------------------------------------ 2. key clips
L += ['## 2. Key clips', '']
rep = J(os.path.join(P, 'realtime', 'media_feat', 'report.json')).get('f_flips', {})
b = rep.get('best', {})
L += ['**(a) Flips, real time** (`tools/capture/rt_clips.mjs --only f_flips`, `?test&mute&mode=pro`, 1280x720 viewport, true 60 fps canvas capture,',
      'real F / WASD / Space key events, captions + key viewer burned in at the 60 fps conversion).']
if exists('clips/rt_feat_f_flips.mp4'):
    L.append(f"- `clips/rt_feat_f_flips.mp4` ({probe(os.path.join(P, 'clips/rt_feat_f_flips.mp4'))}) - Pro, side-on: F while rolling (quick-pop kickflip), Space crouch + D + F "
             f"(heelflip), S + F (pop shove-it), W + F (tre flip), Space ollie then F in the air (late flip). Take {b.get('take', '?')}: flips {b.get('flips')}, landings "
             f"{b.get('lands')}, bails {b.get('bails') or 'none'}; raw capture {(b.get('rawProbe') or {}).get('fps', '?')} fps, median displayed frame {b.get('medianFrameMs')} ms. "
             f"{N.get('flips', 'Same script, scenario and camera as the pass-04 twin.')}")
if exists('clips/rt_feat_f_flips_quarter.mp4'):
    L.append(f"- `clips/rt_feat_f_flips_quarter.mp4` ({probe(os.path.join(P, 'clips/rt_feat_f_flips_quarter.mp4'))}) - the same at quarter speed (setpts=4*PTS, every frame shown 4x)")
if exists('sheets/rt_feat_f_flips.jpg'):
    L.append('- `sheets/rt_feat_f_flips.jpg` - 12 frames at the key moments (video times), as pass 4')
if os.path.isdir(os.path.join(P, 'realtime', 'media_feat')):
    L.append('- `realtime/media_feat/` - raw MediaRecorder take(s) `f_flips_take*_raw.mp4`, `f_flips_sheet.json`, `report.json` (events with video times)')
L.append('')
mt = os.path.join(P, 'realtime', 'media_rec', 'metrics.txt')
jl = [ln for ln in open(mt, encoding='utf8').read().splitlines() if ln.startswith('bowl_carve')] if os.path.exists(mt) else []
trims = J(os.path.join(P, 'realtime', 'media_rec', 'trims.json')).get('bowl_carve')
L += ['**(b) Bowl carve, real time** (`tools/realtime/media_protocol.mjs --name media_rec --only bowl_carve --record`, then `strips_from_run.py` and',
      '`media_post.py`; main bowl at 7.5 m/s with A/D carves, 880x640 window at DPR 1.2 -> 1038x656 canvas, canvas.captureStream(60) + MediaRecorder,',
      'made constant 60 fps).']
for f, d in [('clips/realtime/rt_bowl_carve_60fps.mp4', 'the recording, constant 60 fps' + (f" (starts {trims['trimmed_start_s']} s into the capture: encoder start-up hole {trims['raw_gap_s']})" if trims else '')),
             ('clips/realtime/rt_bowl_carve_quarter.mp4', 'quarter speed (setpts=4*PTS, still 60 fps)')]:
    if exists(f):
        L.append(f"- `{f}` ({probe(os.path.join(P, f))}) - {d}")
for f, d in [('sheets/realtime/rt_bowl_carve_slitscan.png', 'one pixel row through the hips per 60 fps frame (1.0-2.0 s), stacked: a straight edge = smooth'),
             ('sheets/realtime/rt_bowl_carve_frames8.png', '8 consecutive 60 fps frames from 1.0 s, fixed crop round the hips, red cross = median hips position')]:
    if exists(f):
        L.append(f'- `{f}` - {d}')
if jl:
    L.append(f"- `realtime/media_rec/` - logs, raw capture, `metrics.txt`. Metric with recording on: `{' '.join(jl[0].split())}` "
             f"(pass-04 media_rec: frame_std 1.05 ms | hips rms 0.21 p99 1.00 px | head p99 1.51 px). {N.get('bowl', '')}".rstrip())
L.append('')
ex = J(os.path.join(P, 'clips', 'clip50_autoride_lap_excerpt.json'))
sm = J(os.path.join(P, 'autoride', 'summary.json'))
L += ['**(c) Auto-ride lap excerpt** (`tools/sim/auto_final2.mjs`, `?test&mute&mode=auto`, real time, 1280x720 canvas capture at 60 fps; LAP_SECS=84,',
      'no handoff / attract segments; `tools/capture/media5_autoride_excerpt.py` picks the 30 s window with the most half-pipe events, never a bail).']
if exists('clips/clip50_autoride_lap_excerpt.mp4'):
    L.append(f"- `clips/clip50_autoride_lap_excerpt.mp4` ({probe(os.path.join(P, 'clips/clip50_autoride_lap_excerpt.mp4'))}) - lap {ex.get('window')} s: lines "
             f"{' -> '.join(ex.get('lines', []))}; events {', '.join(e for e in ex.get('events', []) if ' pop' not in e)}; captions: current autopilot line + game events. "
             f"Pass-04 twin `clip50_autoride_lap.mp4` is the whole 90 s lap; {N.get('autoride', 'same lap order and timing as pass 4.')}")
for f, d in [('clips/clip50_autoride_lap_excerpt.json', 'window, lines and events of the excerpt'), ('sheets/clip50_autoride_lap_excerpt.jpg', '12 evenly spaced frames, labelled with the line')]:
    if exists(f):
        L.append(f'- `{f}` - {d}')
if sm:
    L.append(f"- `autoride/` - the source lap: `autoride_lap.mp4` ({sm.get('lap', {}).get('secs')} s, {sm.get('lap', {}).get('fps')} fps raw MediaRecorder), `lap_sheet.jpg`, "
             f"`autoride_log.json`, `summary.json`, `console.log`; lines {', '.join(sm.get('lines', []))}; bails {len(sm.get('bails', []))}")
L.append('')

# ------------------------------------------------------------------ 3. mobile touch clip
L += ['## 3. Real-time touch clip in mobile emulation (`clips/mobile/`, `sheets/mobile/`)', '',
      '`tools/capture/mobile_touch_clip.mjs` (new): headless Chrome (new headless, hardware GPU, no window), iPhone-like 390x844 @3x, iOS UA,',
      'isMobile + hasTouch (5 points), emulated safe-area insets (portrait top 47 / bottom 34, landscape left/right 47, bottom 21), no `?test`',
      '(attract title "Tap to ride", Easy by default, mobile quality tier). Real CDP touch (Input.dispatchTouchEvent). The PAGE is recorded',
      '(CDP Page.startScreencast, compositor timestamps) and made constant 60 fps; a caption band under the screen says what the touch does',
      '(white) and what the page reported (yellow, read from the HUD DOM); white rings mark the touch points (drawn in the page, pointer-events none).',
      'iPhone Safari has no element fullscreen, so `document.fullscreenEnabled` is hidden (as mobile-qa hygiene.mjs does) and the pause menu shows',
      'its Add to Home Screen tip. Up to 3 takes, the first without a bail is kept.', '']
for nm in ['touch_iphone_portrait', 'touch_iphone_landscape']:
    f = f'clips/mobile/{nm}.mp4'
    if not exists(f):
        continue
    mr = J(os.path.join(P, 'clips', 'mobile', nm + '.json'))
    tk = next((t for t in mr.get('takes', []) if t.get('take') == mr.get('best')), {})
    steps = '; '.join(f"{s['t']} s {s['what']}" for s in tk.get('steps', []))
    L.append(f"- `{f}` ({probe(os.path.join(P, f))}) - {mr.get('url')}: {steps}. Screencast {tk.get('frames')} frames in {tk.get('seconds')} s = {tk.get('avgFps')} fps "
             f"average (median gap {tk.get('medianFrameMs')} ms), take {mr.get('best')} of {len(mr.get('takes', []))}, bail in the kept take: {tk.get('bails')}. "
             f"Add to Home tip shown: {bool(tk.get('tipCheck', {}).get('after', {}).get('tip'))}, Fullscreen row present: {any(s.get('fsRow') for s in tk.get('steps', []))}. New (no pass-04 twin; pass 4 had stills only).")
    L.append(f'- `clips/mobile/{nm}.json` - profile, every take (steps with video times, DOM state, screencast rate, console errors), encode captions')
    if exists(f'sheets/mobile/{nm}.jpg'):
        L.append(f'- `sheets/mobile/{nm}.jpg` - 12 frames at the key moments')
L.append('')

# ------------------------------------------------------------------ 4. mobile screens
cp = J(os.path.join(P, 'mobile', 'screens', 'copied.json'))
L += ['## 4. Mobile evidence screenshots (`mobile/screens/`)', '', N.get('mobile_src', f"Copied from `{cp.get('source', '?')}` by `tools/capture/media5_mobile_screens.py`."), '']
VIEWD = {'1_gameplay': 'gameplay with the touch controls', '2_midtrick': 'mid-trick', '4_pause_menu': 'pause menu', 'add_to_home_tip': 'pause menu with the Add to Home Screen tip (no element fullscreen emulated)',
         'toast_position': 'auto-ride toast position against the touch controls'}
for src, dst in cp.get('copied', []):
    prof, orient, view = dst[:-4].split('_', 2)
    size = {'iphone': ('iPhone-like', '390x844', '844x390', '@3x'), 'android': ('Android', '412x915', '915x412', '@2.625')}[prof]
    L.append(f"- `mobile/screens/{dst}` - {size[0]} {size[1] if orient == 'portrait' else size[2]} {size[3]} {orient}: {VIEWD.get(view, view)} (protocol shot `{src}`)")
for s in ['portrait', 'landscape']:
    if exists(f'mobile/screens/sheet_{s}.jpg'):
        L.append(f'- `mobile/screens/sheet_{s}.jpg` - contact sheet of the {s} shots above (iPhone row, Android row)')
if cp:
    L.append('- `mobile/screens/copied.json` - source -> name map')
L.append('')
for x in N.get('extra', []):
    L.append(x)
if N.get('missing'):
    L += ['## Missing / caveats', ''] + [f'- {x}' for x in N['missing']] + ['']

# ------------------------------------------------------------------ 5. regenerate
L += ['## How to regenerate', '', '```',
      'cd /c/Code/skate-park',
      'bash tools/heavy.sh media bash tools/capture/media5_final.sh A M    # stills (dev/media/final/{fs,first}) + mobile portrait clip (5189 preview, else 5188)',
      'bash tools/heavy.sh media bash tools/capture/media5_final.sh B R    # flips (+ quarter), bowl carve (+ strips, post), auto-ride lap + excerpt',
      'bash tools/heavy.sh media bash tools/capture/media5_final.sh L      # optional landscape touch clip',
      'for n in e_golden_hour_wide e_sunset_wide e_blue_hour_lamps_wide e_bright_noon_wide b_face_neutral b_5050 c_bowl_main; do cp dev/media/final/fs/screens/$n.png screens/; done   # (in pass-05)',
      'cp dev/media/final/first/screens/a_first_frame_golden.png screens/',
      'python tools/capture/media5_compare.py a_first_frame_golden e_golden_hour_wide e_sunset_wide e_blue_hour_lamps_wide e_bright_noon_wide b_face_neutral b_5050 c_bowl_main',
      'python tools/capture/media5_mobile_screens.py E:/shots/skate-park/pass-05/mobile/after_local/shots --src "<run label>"',
      'python tools/capture/media5_manifest.py',
      '```', '',
      'Tool edits (pass 5, helper media): `rt_clips.mjs` and `media_post.py` default to pass-05 (`MEDIA_OUT` overrides); `media_protocol.mjs` warms the',
      "page's first MediaRecorder before the first recorded scenario (without it `--only bowl_carve` started its keys ~1 s late and flew out of the bowl);",
      'new `mobile_touch_clip.mjs`, `media5_final.sh`, `media5_compare.py`, `media5_autoride_excerpt.py`, `media5_mobile_screens.py`, `media5_manifest.py`.', '',
      '`dev/media/` is scratch (final-run logs and stills sessions in `final/`, dry runs on pre-freeze code in `dry/`), not part of the set.', '']
open(os.path.join(P, 'm_manifest.md'), 'w', encoding='utf8').write('\n'.join(L))
print('\n'.join(L))
