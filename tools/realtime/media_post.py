"""M2 deliverables from a protocol run (tools/realtime/media_protocol.mjs --record output).

usage: python media_post.py RUN_DIR [--noencode]
  clips/realtime/rt_<scenario>_60fps.mp4    the constant 60 fps canvas recording (copy of RUN_DIR/video/<scenario>.mp4)
  clips/realtime/rt_<scenario>_quarter.mp4  quarter speed (setpts=4*PTS, still 60 fps: every frame shown 4x)
  sheets/realtime/rt_exact200_frames6.png, rt_exact200_slitscan.png, rt_<scenario>_slitscan.png  (strips_from_run.py)
  sheets/realtime/rt_<scenario>_frames8.png  8 consecutive 60 fps frames from 1.0 s, fixed crop round the hips, red
                                             cross = median hips position of those frames (from the frame log)
  RUN_DIR/metrics.txt                         jitter + feel metric table
Encodes (quarter speed) need the heavy lock: run through tools/heavy.sh.
"""
import json
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

run = sys.argv[1]
ENC = '--noencode' not in sys.argv
P4 = 'E:/shots/skate-park/pass-04'
CL, SH = os.path.join(P4, 'clips', 'realtime'), os.path.join(P4, 'sheets', 'realtime')
os.makedirs(CL, exist_ok=True)
os.makedirs(SH, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
try:
    FONT = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 14)
except OSError:
    FONT = ImageFont.load_default()

# ---------------------------------------------------------------- strips from strips_from_run.py
st = os.path.join(run, 'strips')
for f in sorted(os.listdir(st)) if os.path.isdir(st) else []:
    dst = {'frames6.png': 'rt_exact200_frames6.png', 'slitscan_exact.png': 'rt_exact200_slitscan.png'}.get(f)
    if dst is None and f.startswith('slitscan_'):
        dst = 'rt_' + f[len('slitscan_'):-4] + '_slitscan.png'
    if dst:
        shutil.copy2(os.path.join(st, f), os.path.join(SH, dst))


def col(d, k):
    h = {n: i for i, n in enumerate(d['header'])}
    return np.array([r[h[k]] for r in d['rows']], float)


def start_gap(scen):
    """(start, end) s of a > 0.2 s hole in the raw capture within its first 1.2 s (MediaRecorder / encoder start-up)"""
    rr = os.path.join(run, 'video', 'raw', scen + '.mp4')
    o = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', rr], capture_output=True, text=True).stdout
    t = sorted(float(x) for x in o.split() if x.strip() not in ('', 'N/A'))
    for a, b in zip(t, t[1:]):
        if b - t[0] > 1.2:
            break
        if b - a > 0.2:
            return round(a - t[0], 3), round(b - t[0], 3)
    return None


# ---------------------------------------------------------------- per recording: copy, quarter speed, 8-frame strip
done, trims = [], {}
for f in sorted(os.listdir(os.path.join(run, 'logs'))):
    scen = f[:-5]
    d = json.load(open(os.path.join(run, 'logs', f)))
    v = os.path.join(run, 'video', scen + '.mp4')
    if not d.get('video') or not os.path.exists(v):
        continue
    out60, outq = os.path.join(CL, f'rt_{scen}_60fps.mp4'), os.path.join(CL, f'rt_{scen}_quarter.mp4')
    gap = start_gap(scen)
    if gap and ENC:
        # the capture (not the game: see the frame log) had a hole at the start: the deliverable starts after it
        trims[scen] = {'raw_gap_s': gap, 'trimmed_start_s': round(gap[1] + 0.02, 3)}
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', f'{gap[1] + 0.02:.3f}', '-i', v, '-r', '60', '-c:v', 'libx264', '-preset', 'medium',
                        '-crf', '16', '-pix_fmt', 'yuv420p', '-threads', '4', '-movflags', '+faststart', out60], check=True)
    else:
        shutil.copy2(v, out60)
    if ENC:
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', out60, '-vf', 'setpts=4*PTS', '-r', '60',
                        '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-threads', '4',
                        '-movflags', '+faststart', outq], check=True)
    # 8 consecutive frames from 1.0 s; crop centred on the median hips position of those frames (log rows by time)
    w, h = [int(x) for x in subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                                            '-of', 'csv=p=0', v], capture_output=True, text=True).stdout.strip().split(',')]
    p = subprocess.run(['ffmpeg', '-v', 'error', '-ss', '1.0', '-i', v, '-frames:v', '8', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                       capture_output=True).stdout
    n = len(p) // (w * h * 3)
    if n:
        frames = np.frombuffer(p[:n * w * h * 3], np.uint8).reshape(n, h, w, 3)
        t, hx, hy = col(d, 't'), col(d, 'hsx'), col(d, 'hsy')
        rec0 = d.get('recT0') or t[0]
        dpr = d.get('cal', {}).get('dpr', 1.0)
        idx = [int(np.argmin(np.abs(t - (rec0 + (1.0 + k / 60) * 1000)))) for k in range(n)]
        cx, cy = int(np.median(hx[idx]) * dpr), int(np.median(hy[idx]) * dpr)
        CW, CH, S = 190, 300, 1.6
        x0, y0 = max(0, min(w - CW, cx - CW // 2)), max(0, min(h - CH, cy - CH // 2))
        tiles = []
        for k in range(n):
            im = Image.fromarray(frames[k][y0:y0 + CH, x0:x0 + CW].copy()).resize((int(CW * S), int(CH * S)), Image.NEAREST)
            dr = ImageDraw.Draw(im)
            gx, gy = (cx - x0) * S, (cy - y0) * S
            dr.line([(gx, 0), (gx, im.height)], fill=(255, 40, 40), width=1)
            dr.line([(0, gy), (im.width, gy)], fill=(255, 40, 40), width=1)
            dr.rectangle([0, im.height - 22, im.width, im.height], fill=(0, 0, 0))
            dr.text((6, im.height - 19), f'{scen} {1.0 + k / 60:.3f} s (#{k})', fill=(255, 255, 255), font=FONT)
            tiles.append(im)
        c = Image.new('RGB', (sum(x.width for x in tiles) + 6 * (len(tiles) + 1), tiles[0].height + 12), (24, 24, 28))
        x = 6
        for im in tiles:
            c.paste(im, (x, 6))
            x += im.width + 6
        c.save(os.path.join(SH, f'rt_{scen}_frames8.png'))
    done.append(scen)
print('recordings:', ', '.join(done))
if ENC:
    json.dump(trims, open(os.path.join(run, 'trims.json'), 'w'), indent=1)
    print('trimmed starts (capture holes):', trims)

# ---------------------------------------------------------------- metric table
logs = [os.path.join(run, 'logs', f) for f in sorted(os.listdir(os.path.join(run, 'logs'))) if f.endswith('.json')]
jm = subprocess.run(['python', os.path.join(HERE, 'jitter_metric.py'), *logs], capture_output=True, text=True).stdout
fm = subprocess.run(['python', os.path.join(HERE, 'feel_metric.py'), run], capture_output=True, text=True).stdout
s = json.load(open(os.path.join(run, 'summary.json')))
head = [f"run {s.get('name')}  {s.get('when')}  url {s.get('url')}  mode {s.get('mode')}",
        f"native frame interval (median) {s.get('nativeFrameMs')} ms; recordings: canvas.captureStream(60) + MediaRecorder -> ffmpeg fps=60",
        'notes: ' + '; '.join(s.get('notes', [])),
        'thresholds (pass if <=): frame_std 1.0 ms, hips_rms 0.35 px, hips_p99 1.2 px, head_p99 2.0 px, board_rms 1.0 mm, flips 30/s, hf_share 0.25, stall_frames 0',
        '']
fr = []
for scen, v in s.get('scenarios', {}).items():
    fr.append(f"{scen:14s} frames {v.get('frames')}  median dt {v.get('medianDt')} ms  events {','.join(v.get('events', []))}")
open(os.path.join(run, 'metrics.txt'), 'w', encoding='utf8').write('\n'.join(head) + '\n== jitter_metric.py\n' + jm + '\n== feel_metric.py\n' + fm + '\n== frames\n' + '\n'.join(fr) + '\n')
print(open(os.path.join(run, 'metrics.txt'), encoding='utf8').read())
