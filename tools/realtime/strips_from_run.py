"""Strips for a protocol run (tools/realtime/rt_protocol.mjs output folder).

usage: python strips_from_run.py RUN_DIR

  RUN_DIR/strips/frames6.png        6 consecutive displayed frames at 200 Hz (exact200/), red = smooth path of the hips,
                                    green = actual hips, offset in 1080p pixels
  RUN_DIR/strips/slitscan_exact.png one pixel row through the hips per displayed frame, stacked (zig-zag = judder)
  RUN_DIR/strips/slitscan_<scenario>.png  same from the real-time 60 fps recordings (video/<scenario>.mp4), 1 s
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

run = sys.argv[1]
ST = os.path.join(run, 'strips')
os.makedirs(ST, exist_ok=True)
try:
    FONT = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 16)
except OSError:
    FONT = ImageFont.load_default()


def col(d, k):
    h = {n: i for i, n in enumerate(d['header'])}
    return np.array([r[h[k]] for r in d['rows']], float)


ex = os.path.join(run, 'exact200')
if os.path.exists(os.path.join(ex, 'log.json')):
    d = json.load(open(os.path.join(ex, 'log.json')))
    clip = d['clip']
    frames = [Image.open(os.path.join(ex, f'f{i:02d}.png')).convert('RGB') for i in range(24)]
    s = frames[0].width / clip['width']
    hx, hy, n, H = col(d, 'hsx'), col(d, 'hsy'), col(d, 'n'), col(d, 'H')[0]
    smooth = np.polyval(np.polyfit(np.arange(24), hx, 1), np.arange(24))
    dev = (hx - smooth) * 1080 / H
    y = int(round(np.median(hy - clip['y']) * s))
    rows = np.stack([np.asarray(f)[y] for f in frames])
    Image.fromarray(rows).resize((rows.shape[1] * 2, rows.shape[0] * 12), Image.NEAREST).save(os.path.join(ST, 'slitscan_exact.png'))
    tiles = []
    cx, cy = np.mean(hx[6:12]), np.mean(hy[6:12])
    for i in range(6, 12):
        box = (int((cx - clip['x'] - 35) * s), int((cy - clip['y'] - 30) * s), int((cx - clip['x'] + 35) * s), int((cy - clip['y'] + 100) * s))
        t = frames[i].crop(box).resize(((box[2] - box[0]) * 3, (box[3] - box[1]) * 3), Image.NEAREST)
        dr = ImageDraw.Draw(t)
        gx, ax = ((smooth[i] - clip['x']) * s - box[0]) * 3, ((hx[i] - clip['x']) * s - box[0]) * 3
        dr.line([(gx, 0), (gx, t.height)], fill=(255, 40, 40), width=2)
        dr.line([(ax, 0), (ax, 40)], fill=(40, 255, 80), width=4)
        dr.rectangle([0, t.height - 24, t.width, t.height], fill=(0, 0, 0))
        dr.text((6, t.height - 22), f'#{i} {int(n[i])} step(s) {dev[i]:+.1f}px', fill=(255, 255, 255), font=FONT)
        tiles.append(t)
    c = Image.new('RGB', (sum(t.width for t in tiles) + 8 * 7, tiles[0].height + 16), (24, 24, 28))
    x = 8
    for t in tiles:
        c.paste(t, (x, 8)); x += t.width + 8
    c.save(os.path.join(ST, 'frames6.png'))
    print('exact strip: hips offset RMS %.2f px (1080p), steps %s' % (np.sqrt(np.mean(dev ** 2)), n.astype(int).tolist()))

for f in sorted(os.listdir(os.path.join(run, 'logs'))):
    d = json.load(open(os.path.join(run, 'logs', f)))
    v = os.path.join(run, 'video', f.replace('.json', '.mp4'))
    if not d.get('video') or not os.path.exists(v):
        continue
    dpr = d.get('cal', {}).get('dpr', 1.0)
    hx, hy = col(d, 'hsx'), col(d, 'hsy')
    y, x = int(round(np.median(hy) * dpr)), int(round(np.median(hx) * dpr))
    w = int(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', v], capture_output=True, text=True).stdout.strip())
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', '1.0', '-t', '1.0', '-i', v, '-vf', f'format=rgb24,crop={w}:2:0:{y}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    rows = []
    while True:
        b = p.stdout.read(w * 6)
        if len(b) < w * 6:
            break
        rows.append(np.frombuffer(b, np.uint8).reshape(2, w, 3)[0])
    p.wait()
    if rows:
        R = np.stack(rows)[:, max(0, x - 110):x + 110]
        Image.fromarray(R).resize((R.shape[1] * 2, R.shape[0] * 5), Image.NEAREST).save(os.path.join(ST, f'slitscan_{f[:-5]}.png'))
        print('slit-scan', f[:-5], R.shape)
