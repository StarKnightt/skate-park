"""M2 manifest: E:/shots/skate-park/pass-04/m2_manifest.md from the protocol run + feature clip report.

usage: python media_manifest.py [RUN_DIR] [--missing "text"]
"""
import json
import os
import subprocess
import sys

P4 = 'E:/shots/skate-park/pass-04'
run = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else os.path.join(P4, 'realtime', 'media_rec')
missing = sys.argv[sys.argv.index('--missing') + 1] if '--missing' in sys.argv else ''
FEAT = os.path.join(P4, 'realtime', 'media_feat')


def probe(f):
    o = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames:format=duration',
                        '-of', 'json', f], capture_output=True, text=True).stdout
    try:
        j = json.loads(o)
        s = j['streams'][0]
        n, d = s['r_frame_rate'].split('/')
        return f"{s['width']}x{s['height']}, {float(n) / float(d):.0f} fps CFR, {float(j['format']['duration']):.2f} s"
    except Exception:
        return '?'


SCEN = {
    'flat_side': 'flat ground 6 m/s, camera side-on', 'flat_behind': 'flat ground 6 m/s, camera behind', 'steer': '5 m/s, A 0.45 s / D 0.8 s / A 0.45 s (slalom)',
    'push': 'hold W 3 s from standstill', 'brake': '6 m/s, S 1.2 s', 'bowl_carve': 'main bowl at 7.5 m/s with A/D carves',
    'quarter_pipe': 'quarter pipe at 4.8 m/s, up and back (kickturn)', 'halfpipe': 'half pipe at 9.6 m/s, W at 2.6 s (pump, vert airs)',
    'kickflip': 'side-on, Space 250 ms + F (kickflip at the current charge)', 'dropin_bowl': 'drop-in from the main bowl deck at 4.5 m/s, side-on',
    'orbit_drag': 'mouse drag orbit 300 px and back, 150 px down', 'mouselook': 'click the canvas -> pointer lock (emulated), mouse moves, Esc',
}
L = ['# M2 manifest - pass 4 real-time media', '',
     'All runs: headed Chrome on the portrait second monitor only (window at x=1930, y=20; never on the main monitor), real time',
     '(no `?fps`, no frame stepping), real Playwright keyboard / mouse events, every browser run and encode through `tools/heavy.sh M2`.',
     'Chrome paces rAF at the 200 Hz primary display rate: logged median frame interval 5.00 ms in every run.',
     'Pointer lock: the test window never takes the foreground (the user works on the main monitor), so Chrome refuses a real',
     'lock - and a real lock would confine the user\'s cursor. The Pointer Lock API is emulated in the page',
     '(`tools/realtime/media_common.mjs` `emulateLock`): the game\'s own lock path runs unchanged (click -> requestPointerLock ->',
     'pointerlockchange -> raw movementX/Y look; Esc consumed like the browser does -> unlock -> pause).', '']

# ---------------------------------------------------------------- protocol
s = json.load(open(os.path.join(run, 'summary.json')))
L += ['## 1. Real-time protocol with recordings', '',
      f"Run `{s.get('name')}` ({s.get('when')}), `{s.get('url')}`, command `bash tools/heavy.sh M2 node tools/realtime/media_protocol.mjs --name media_rec --record`",
      '(`media_protocol.mjs` = `rt_protocol.mjs` + the pointer-lock emulation; same scenarios, logging, recorder and metrics).',
      f"Run folder: `{run}` (logs/, video/raw/ MediaRecorder files, video/ constant 60 fps, exact200/, strips/, metrics.txt).", '',
      '**Recording method:** `canvas.captureStream(60)` + `MediaRecorder` (H.264, 30 Mb/s) in the page while the logged run plays in',
      'real time; raw files are variable-rate, converted to constant 60 fps with `ffmpeg -vf fps=60 -threads 4`. Canvas 1038x656',
      '(880x640 window: 867x548 CSS px at devicePixelRatio 1.2). Quarter speed: `setpts=4*PTS`, output still 60 fps (every frame shown 4x).', '']
raw = os.path.join(run, 'video', 'raw')
trims = json.load(open(os.path.join(run, 'trims.json'))) if os.path.exists(os.path.join(run, 'trims.json')) else {}
L += ['| scenario | setup | 60 fps clip | quarter speed | raw capture rate |', '|---|---|---|---|---|']
for scen in SCEN:
    f60 = os.path.join(P4, 'clips', 'realtime', f'rt_{scen}_60fps.mp4')
    if not os.path.exists(f60):
        continue
    rr = os.path.join(raw, scen + '.mp4')
    o = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets:format=duration', '-of', 'json', rr],
                       capture_output=True, text=True).stdout
    try:
        j = json.loads(o)
        rate = f"{int(j['streams'][0]['nb_read_packets']) / float(j['format']['duration']):.1f} fps ({j['streams'][0]['nb_read_packets']} frames)"
    except Exception:
        rate = '?'
    q = os.path.join(P4, 'clips', 'realtime', f'rt_{scen}_quarter.mp4')
    tr = trims.get(scen)
    note = f"; starts at {tr['trimmed_start_s']} s of the recording (capture start-up hole {tr['raw_gap_s'][0]}-{tr['raw_gap_s'][1]} s)" if tr else ''
    L.append(f"| {scen} | {SCEN[scen]} | `clips/realtime/rt_{scen}_60fps.mp4` ({probe(f60)}{note}) | " +
             (f"`clips/realtime/rt_{scen}_quarter.mp4` ({probe(q)})" if os.path.exists(q) else 'missing') + f' | {rate} |')
L += ['', '**Strips / slit-scans** (`sheets/realtime/`):', '',
      '- `rt_exact200_frames6.png` - 6 consecutive displayed frames at exactly 1/200 s (manual clock, the same simulate() + render() path,',
      '  frame-stepped stills, flat side-on 6 m/s), red = smooth hips path, green = actual hips, offset in 1080p px.',
      '- `rt_exact200_slitscan.png` - one pixel row through the hips per exact 200 Hz frame (24 frames), stacked: a straight edge = smooth.',
      '- `rt_<scenario>_slitscan.png` - the same from each real-time 60 fps recording (1.0-2.0 s, 60 rows).',
      '- `rt_<scenario>_frames8.png` - 8 consecutive real-time 60 fps frames from 1.0 s, fixed crop round the hips, red cross = median',
      '  hips position of those frames from the frame log (the follow camera keeps him still on screen: wobble = judder).', '']
mt = os.path.join(run, 'metrics.txt')
if os.path.exists(mt):
    L += ['**Metric table** (`realtime/media_rec/metrics.txt`):', '', '```', open(mt, encoding='utf8').read().rstrip(), '```', '']

# ---------------------------------------------------------------- feature clips
rep = json.load(open(os.path.join(FEAT, 'report.json'))) if os.path.exists(os.path.join(FEAT, 'report.json')) else {}
L += ['## 2. Feature clips (real time, 1280x720)', '',
      'Script: `bash tools/heavy.sh M2 node tools/capture/rt_clips.mjs` (takes, raw recordings, per-take event logs and report.json in',
      '`realtime/media_feat/`). Captions are burned in at the constant-60 fps conversion: what the input does (my intent), what the game',
      'reported (`(game) ...` from `__skate` events) and a key viewer (yellow = key held, from the logged key events).', '']
DESC = {
    'f_flips': ('rt_feat_f_flips', 'Pro, side-on: F while rolling (quick-pop kickflip), Space crouch + D + F (heelflip), S + F (pop shove-it), W + F (tre flip), Space ollie then F in the air (late flip)'),
    'pause_menu': ('rt_feat_pause_menu', 'click the canvas -> pointer lock, mouse look, one Esc -> unlock + pause menu, Controls page + Gamepad tab, Back, time of day change, Resume (re-locks), look, Esc, Resume'),
    'easy_cruise': ('rt_feat_easy_cruise_autogrind', 'Easy: W tap starts the auto-push cruise, A/D steering, Space tap beside the long ledge -> auto-grind 50-50 with no E, carve away'),
    'bail_bowl': ('rt_feat_bail_recovery_bowl', 'main bowl E wall bail just under the coping, then the recovery (slide to the floor, get up on level ground, board, step on): Pro, then Easy (fast recovery)'),
}
for k, (name, d) in DESC.items():
    r = rep.get(k)
    f = os.path.join(P4, 'clips', name + '.mp4')
    if not r or not os.path.exists(f):
        L += [f'- `clips/{name}.mp4` - **missing**' + (f" ({r.get('error', '').splitlines()[0]})" if r and r.get('error') else ''), '']
        continue
    L += [f'- `clips/{name}.mp4` ({probe(f)}) - {d}.', f"  Sheet: `sheets/{name}.jpg` (12 frames at key moments, video times). Method: {r.get('method')}."]
    fq = os.path.join(P4, 'clips', name + '_quarter.mp4')
    if os.path.exists(fq):
        L.append(f'  Quarter speed: `clips/{name}_quarter.mp4` ({probe(fq)}, setpts=4*PTS).')
    if k == 'pause_menu':
        sc = r.get('screencast', {})
        L += [f"  Screencast: {sc.get('frames')} frames in {sc.get('seconds')} s = {sc.get('avgFps')} fps average (median frame gap {sc.get('medianFrameMs')} ms;",
              '  the game draws at ~10 fps while paused, so menu stretches hold frames), output constant 60 fps.',
              '  Steps (paused / locked / menu open / page): ' + '; '.join(f"{x['what']}: {x['paused']}/{x['locked']}/{x['menu']}/{x['page']}" for x in r.get('steps', []))]
    elif k != 'bail_bowl':
        b = r.get('best', {})
        rp = b.get('rawProbe') or {}
        L.append(f"  Raw canvas capture {rp.get('fps')} fps ({rp.get('frames')} frames / {rp.get('dur')} s), median displayed frame {b.get('medianFrameMs')} ms, frames > 12 ms: {b.get('longFrames')}.")
        if k == 'f_flips':
            L.append(f"  Take {b.get('take')} of {len(r.get('takes', []))}: flips {b.get('flips')}, landings {b.get('lands')}, bails {b.get('bails') or 'none'}.")
        if k == 'easy_cruise':
            L.append(f"  Take {b.get('take')} of {len(r.get('takes', []))} (wiggle {b.get('wiggle')}): grinds {b.get('grinds')}, E pressed {b.get('ePressed')}, bails {b.get('bails') or 'none'}, assist {r.get('assist')}, pop at {b.get('speedAtPop')} m/s z {b.get('zAtPop')}.")
    if k == 'bail_bowl':
        for t in r.get('takes', []):
            rp = t.get('rawProbe') or {}
            L.append(f"  {t['mode']}: riding again {t.get('ridingAfter')} s after the bail; phases " + ' > '.join(f"{p['phase']}/{p['mode']}@{p['t']}" for p in t.get('phases', [])) +
                     f"; get-up/walk/step-on at {t.get('restPos')}; raw {rp.get('fps')} fps, median frame {t.get('medianFrameMs')} ms.")
    L.append('')
L += ['Raw takes / logs: `realtime/media_feat/*_raw.mp4`, `realtime/media_feat/report.json` (all takes, events with video times), `realtime/media_feat/pause_frames/` (screencast JPEGs).', '']
if missing:
    L += ['## Missing', '', missing, '']
NOTES = os.path.join(P4, 'm2', 'notes.md')
if os.path.exists(NOTES):
    L += [open(NOTES, encoding='utf8').read().rstrip(), '']
L += ['## Not recorded here', '', '- Auto-ride laps (helper AP).', '']
open(os.path.join(P4, 'm2_manifest.md'), 'w', encoding='utf8').write('\n'.join(L) + '\n')
print('\n'.join(L))
