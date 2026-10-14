# Pass 5 c-cam keep check: frame-stepped clip07 / clip17 / clip22 cameras (media4.mjs) against the pass-04 frames.
# python tools/capture/c_cam_keep.py <keep dir> <out sheet>
import glob, os, subprocess, sys
from io import BytesIO
import numpy as np
from PIL import Image, ImageDraw, ImageFont

K, OUT = sys.argv[1], sys.argv[2]
P4 = 'E:/shots/skate-park/pass-04'
try:
    FONT = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 15)
except OSError:
    FONT = ImageFont.load_default()
CLIPS = {'clip07_bail_and_get_up': [26, 83, 149, 211, 254, 274], 'clip17_vert_air_close': [44, 65, 134, 143, 206, 286],
         'clip22_bowl_carve_follow': [20, 50, 80, 110, 140]}


def p4_frame(clip, n):
    kf = glob.glob(f'{P4}/screens/keyframes/{clip}_*_f{n:03d}.jpg')
    if kf:
        return Image.open(kf[0]).convert('RGB')
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', f'{P4}/clips/{clip}.mp4', '-vf', f'select=eq(n\\,{n})', '-frames:v', '1',
                          '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True).stdout
    return Image.open(BytesIO(raw)).convert('RGB') if raw else None


rows, lines = [], []
for clip, fr in CLIPS.items():
    for n in fr:
        mine = os.path.join(K, 'frames', clip, f'f{n:04d}.jpg')
        if not os.path.exists(mine):
            continue
        a, b = p4_frame(clip, n), Image.open(mine).convert('RGB')
        if a is None:
            continue
        a = a.resize(b.size)
        diff = float(np.abs(np.asarray(a, np.float32) - np.asarray(b, np.float32)).mean())
        lines.append(f'{clip} f{n:03d}: mean abs diff {diff:.2f}/255')
        w = 400; h = int(b.height * w / b.width)
        pair = Image.new('RGB', (2 * w, h + 18), (16, 16, 16))
        pair.paste(a.resize((w, h)), (0, 18)); pair.paste(b.resize((w, h)), (w, 18))
        ImageDraw.Draw(pair).text((4, 1), f'{clip} f{n:03d}  pass-04 | pass-05 (c-cam)  diff {diff:.1f}', fill=(255, 230, 120), font=FONT)
        rows.append(pair)
if rows:
    per = 2
    W, H = rows[0].width, rows[0].height
    sheet = Image.new('RGB', (per * W, ((len(rows) + per - 1) // per) * H), (16, 16, 16))
    for i, r in enumerate(rows):
        sheet.paste(r, ((i % per) * W, (i // per) * H))
    sheet.save(OUT, quality=85)
open(os.path.join(K, 'keep_diff.txt'), 'w').write('\n'.join(lines) + '\n')
print('\n'.join(lines)); print(OUT)
