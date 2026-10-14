"""Pass-5 auto-ride lap excerpt: a ~30 s window of tools/sim/auto_final2.mjs's lap recording around the half pipe (or bowl).

usage: python media5_autoride_excerpt.py AUTORIDE_DIR OUT.mp4 SHEET.jpg [--secs 30] [--prefer halfpipe|bowl] [--start S]
  AUTORIDE_DIR holds autoride_lap.mp4 + autoride_log.json (events / 10 Hz rows on the page clock that starts with the
  recording). The window maximises the half-pipe (kickturn, vertAir, half-pipe lines) or bowl (dropIn, coping grind,
  bowl lines) score, never a bail; output constant 60 fps with the autopilot's current line captioned. Encodes: heavy lock.
"""
import json
import os
import subprocess
import sys

args = sys.argv[1:]
src, out, sheet = args[0], args[1], args[2]


def opt(k, d):
    return args[args.index('--' + k) + 1] if '--' + k in args else d


SECS = float(opt('secs', 30))
PREFER = opt('prefer', 'halfpipe')
lap = os.path.join(src, 'autoride_lap.mp4')
log = json.load(open(os.path.join(src, 'autoride_log.json')))
dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', lap], capture_output=True, text=True).stdout.strip())
ev, rows = log['ev'], log['rows']  # ev: [t, type, name, x, z]; rows: [t, mode, x, y, z, speed, line, lap, autoActive, suspended, user, hp]
HP = {'kickturn': 2, 'vertAir': 3}
BOWL = {'dropIn': 3, 'kickturn': 1}


def score(a, b):
    s = 0.0
    for t, typ, name, *_ in ev:
        if a <= t <= b:
            if typ == 'bail':
                return -99
            w = (HP if PREFER == 'halfpipe' else BOWL).get(typ, 0)
            if PREFER == 'bowl' and typ == 'grindStart' and 'Coping' in str(name):
                w = 2
            s += w + (0.5 if typ in ('flip', 'grindStart') else 0)
    lines = [r[6] for r in rows if a <= r[0] <= b]
    key = ('half pipe',) if PREFER == 'halfpipe' else ('bowl',)
    s += 0.05 * sum(1 for ln in lines if any(k in ln for k in key))
    return s


if opt('start', None) is not None:
    start = float(opt('start', 0))
else:
    cands = [x * 0.5 for x in range(int(max(0, dur - SECS) * 2) + 1)]
    start = max(cands, key=lambda a: (score(a, a + SECS), -a)) if cands else 0.0
end = min(dur, start + SECS)
# line captions: runs of the same autopilot line inside the window
runs = []
for r in rows:
    if start <= r[0] <= end and r[6]:
        if runs and runs[-1][2] == r[6]:
            runs[-1][1] = r[0]
        else:
            runs.append([r[0], r[0], r[6]])
inwin = [e for e in ev if start <= e[0] <= end and e[1] != 'land']


def dt(text, x, y, a=None, b=None, size=28, color='white', box='black@0.55'):
    t = str(text).replace("'", ' ').replace(':', ' ').replace('%', ' ').replace('\\', ' ')
    en = '' if a is None else f":enable='between(t,{a:.3f},{b:.3f})'"
    return f"drawtext=fontfile=arialbd.ttf:text='{t}':x={x}:y={y}:fontsize={size}:fontcolor={color}:box=1:boxcolor={box}:boxborderw=8{en}"


vf = ['fps=60', dt('Auto-ride  |  real time, 60 fps canvas capture  |  excerpt of a lap', 'w-tw-18', 16, size=19, color='white@0.85', box='black@0.45')]
for i, (a, b, ln) in enumerate(runs):
    nb = runs[i + 1][0] if i + 1 < len(runs) else end
    vf.append(dt(f'line  {ln}', 20, 'h-62', max(0.0, a - start), max(0.1, nb - start), size=28))
for t, typ, name, *_ in inwin:
    lab = {'vertAir': 'vert air', 'kickturn': 'kickturn', 'dropIn': 'drop-in', 'grindStart': f'grind {name}', 'flip': f'{name}', 'pop': 'pop', 'manualStart': 'manual', 'bail': 'BAIL'}.get(typ, typ)
    if typ == 'pop':
        continue
    vf.append(dt(f'(game) {lab}', 20, 16, t - start, t - start + 1.4, size=26, color='0xFFD34D'))
vf.append('format=yuv420p')
os.makedirs(os.path.dirname(out), exist_ok=True)
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', f'{start:.3f}', '-i', lap, '-t', f'{end - start:.3f}', '-vf', ','.join(vf),
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-threads', '4', '-movflags', '+faststart', out], check=True, cwd='C:/Windows/Fonts')
items = []
for k in range(12):
    t = (k + 0.5) * (end - start) / 12
    ln = next((r[2] for r in runs if r[0] - start <= t <= r[1] - start + 0.1), '')
    near = [e for e in inwin if abs(e[0] - start - t) < 0.6 and e[1] not in ('pop',)]
    items.append([round(t, 2), (near[0][1] + ' | ' if near else '') + ln])
tj = os.path.splitext(sheet)[0] + '_items.json'
json.dump(items, open(tj, 'w'))
here = os.path.dirname(os.path.abspath(__file__))
subprocess.run(['python', os.path.join(here, '..', 'realtime', 'media_sheet.py'), out, sheet, tj, '4',
                f'{os.path.basename(out)}  |  auto-ride, real time 60 fps, lap {start:.1f}-{end:.1f} s'], check=True)
os.remove(tj)
info = {'lap': lap, 'lap_secs': round(dur, 2), 'window': [round(start, 2), round(end, 2)], 'prefer': PREFER, 'score': round(score(start, end), 2),
        'lines': [r[2] for r in runs], 'events': [f'{e[0] - start:.2f}s {e[1]} {e[2]}' for e in inwin]}
json.dump(info, open(os.path.splitext(out)[0] + '.json', 'w'), indent=1)
print(json.dumps(info, indent=1))
