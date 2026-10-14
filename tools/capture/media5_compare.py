"""Pass-5 regression stills: pass-04 | pass-05 | |difference| x4 composites and mean absolute differences.

usage: python media5_compare.py NAME [NAME ...] [--p04 DIR] [--p05 DIR] [--out DIR]
  defaults: --p04 E:/shots/skate-park/pass-04/screens  --p05 E:/shots/skate-park/pass-05/screens  --out <p05>/cmp
  -> <out>/<name>_p04_vs_p05.jpg, <out>/compare.json (mean |diff| over RGB in 8-bit levels, share of pixels > 8 and > 32)
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]


def opt(k, d):
    return args[args.index('--' + k) + 1] if '--' + k in args else d


P04 = opt('p04', 'E:/shots/skate-park/pass-04/screens')
P05 = opt('p05', 'E:/shots/skate-park/pass-05/screens')
OUT = opt('out', os.path.join(P05, 'cmp'))
names = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or not args[i - 1].startswith('--'))]
os.makedirs(OUT, exist_ok=True)
try:
    FONT = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 22)
except OSError:
    FONT = ImageFont.load_default()
res_path = os.path.join(OUT, 'compare.json')
res = json.load(open(res_path)) if os.path.exists(res_path) else {}
for n in names:
    a = np.asarray(Image.open(os.path.join(P04, n + '.png')).convert('RGB'), np.int16)
    b = np.asarray(Image.open(os.path.join(P05, n + '.png')).convert('RGB'), np.int16)
    if a.shape != b.shape:
        b = np.asarray(Image.fromarray(b.astype(np.uint8)).resize((a.shape[1], a.shape[0]), Image.LANCZOS), np.int16)
    d = np.abs(a - b)
    px = d.max(axis=2)
    r = {'mean_abs_diff_255': round(float(d.mean()), 2), 'share_px_gt8': round(float((px > 8).mean()), 4), 'share_px_gt32': round(float((px > 32).mean()), 4),
         'size': [int(a.shape[1]), int(a.shape[0])]}
    res[n] = r
    h, w = a.shape[:2]
    top = 40
    c = Image.new('RGB', (3 * w + 4 * 8, h + top + 8), (22, 22, 26))
    for i, im in enumerate([a, b, np.clip(d * 4, 0, 255)]):
        c.paste(Image.fromarray(im.astype(np.uint8)), (8 + i * (w + 8), top))
    dr = ImageDraw.Draw(c)
    labels = ['pass-04 (c1f02a6)', 'pass-05', f'|difference| x4   mean {r["mean_abs_diff_255"]:.2f}/255   pixels > 8/255: {100 * r["share_px_gt8"]:.1f} %   > 32/255: {100 * r["share_px_gt32"]:.1f} %']
    for i, t in enumerate(labels):
        dr.text((8 + i * (w + 8) + 4, 9), (n + '   ' if i == 0 else '') + t, fill=(255, 255, 255), font=FONT)
    c.save(os.path.join(OUT, f'{n}_p04_vs_p05.jpg'), quality=90)
    print(f'{n:28s} mean |diff| {r["mean_abs_diff_255"]:6.2f}/255  px>8 {100 * r["share_px_gt8"]:5.1f} %  px>32 {100 * r["share_px_gt32"]:5.1f} %')
json.dump(res, open(res_path, 'w'), indent=1)
