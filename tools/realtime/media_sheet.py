"""Contact sheet of a clip (decode only).

usage: python media_sheet.py VIDEO OUT.jpg [TIMES.json | N] [COLS] [TITLE]
  TIMES.json: [[t_seconds, "label"], ...]   N: evenly spaced frames (default 12)
"""
import io
import json
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

video, out = sys.argv[1], sys.argv[2]
spec = sys.argv[3] if len(sys.argv) > 3 else '12'
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
title = sys.argv[5] if len(sys.argv) > 5 else ''
try:
    FONT = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 15)
    TFONT = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 20)
except OSError:
    FONT = TFONT = ImageFont.load_default()

dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video],
                           capture_output=True, text=True).stdout.strip())
if spec.endswith('.json'):
    items = json.load(open(spec, encoding='utf8'))
else:
    n = int(spec)
    items = [[(i + 0.5) * dur / n, ''] for i in range(n)]

W = 400
tiles = []
for t, lab in items:
    t = max(0.0, min(dur - 0.03, float(t)))
    png = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', video, '-frames:v', '1', '-vf', f'scale={W}:-2',
                          '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True).stdout
    im = Image.open(io.BytesIO(png)).convert('RGB')
    d = ImageDraw.Draw(im)
    d.rectangle([0, im.height - 24, im.width, im.height], fill=(0, 0, 0))
    d.text((6, im.height - 21), f'{t:5.2f} s' + (f'  {lab}' if lab else ''), fill=(255, 255, 255), font=FONT)
    tiles.append(im)

rows = (len(tiles) + cols - 1) // cols
th = tiles[0].height
top = 34 if title else 0
sheet = Image.new('RGB', (cols * W + (cols + 1) * 6, top + rows * th + (rows + 1) * 6), (22, 22, 26))
if title:
    ImageDraw.Draw(sheet).text((8, 7), title, fill=(255, 255, 255), font=TFONT)
for i, im in enumerate(tiles):
    sheet.paste(im, (6 + (i % cols) * (W + 6), top + 6 + (i // cols) * (th + 6)))
sheet.save(out, quality=88)
print('sheet', out, len(tiles), 'frames')
