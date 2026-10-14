"""Pass-5 mobile evidence: the mobile protocol's layout / hygiene shots copied under clear names + portrait / landscape sheets.

usage: python media5_mobile_screens.py SHOTS_DIR [--out E:/shots/skate-park/pass-05/mobile/screens] [--src "label for the sheets"]
  layout_<iphone|android>_<port|land>_{1_gameplay,2_midtrick,4_pause}.jpg -> <iphone|android>_<portrait|landscape>_<n>_<view>.jpg
  hygiene_<prof>_fs_tip.jpg -> <prof>_<orientation>_add_to_home_tip.jpg, hygiene_<prof>_toast.jpg -> <prof>_<orientation>_toast_position.jpg
  -> <out>/sheet_portrait.jpg, <out>/sheet_landscape.jpg, <out>/copied.json
"""
import json
import os
import shutil
import sys

from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]
src = args[0]


def opt(k, d):
    return args[args.index('--' + k) + 1] if '--' + k in args else d


OUT = opt('out', 'E:/shots/skate-park/pass-05/mobile/screens')
LABEL = opt('src', src)
os.makedirs(OUT, exist_ok=True)
PROF = {'iphone': 'iPhone-like 390x844 @3x', 'android': 'Android 412x915 @2.625'}
VIEWS = {'1_gameplay': '1_gameplay', '2_midtrick': '2_midtrick', '4_pause': '4_pause_menu'}
try:
    FONT = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 17)
    TFONT = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 22)
except OSError:
    FONT = TFONT = ImageFont.load_default()

copied, rows = [], {'portrait': {}, 'landscape': {}}
for p in PROF:
    for o, orient in (('port', 'portrait'), ('land', 'landscape')):
        for v, vn in VIEWS.items():
            f = os.path.join(src, f'layout_{p}_{o}_{v}.jpg')
            if os.path.exists(f):
                dst = f'{p}_{orient}_{vn}.jpg'
                shutil.copy2(f, os.path.join(OUT, dst))
                copied.append([os.path.basename(f), dst])
                rows[orient].setdefault(p, []).append((dst, f'{vn.split("_", 1)[1].replace("_", " ")}'))
    for h, hn in (('fs_tip', 'add_to_home_tip'), ('toast', 'toast_position')):
        f = os.path.join(src, f'hygiene_{p}_{h}.jpg')
        if os.path.exists(f):
            w, hh = Image.open(f).size
            orient = 'landscape' if w > hh else 'portrait'
            dst = f'{p}_{orient}_{hn}.jpg'
            shutil.copy2(f, os.path.join(OUT, dst))
            copied.append([os.path.basename(f), dst])
            rows[orient].setdefault(p, []).append((dst, hn.replace('_', ' ')))


def sheet(orient, th):
    lines = [(p, items) for p, items in rows[orient].items() if items]
    if not lines:
        return None
    tiles = []
    for p, items in lines:
        row = []
        for dst, lab in items:
            im = Image.open(os.path.join(OUT, dst)).convert('RGB')
            im = im.resize((round(im.width * th / im.height), th), Image.LANCZOS)
            t = Image.new('RGB', (im.width, th + 26), (0, 0, 0))
            t.paste(im, (0, 0))
            ImageDraw.Draw(t).text((6, th + 4), f'{p} {orient}: {lab}', fill=(255, 255, 255), font=FONT)
            row.append(t)
        tiles.append((p, row))
    W = max(sum(t.width for t in row) + 8 * (len(row) + 1) for _, row in tiles)
    H = 40 + sum(th + 26 + 8 + 30 for _ in tiles) + 8
    s = Image.new('RGB', (W, H), (22, 22, 26))
    d = ImageDraw.Draw(s)
    d.text((8, 8), f'pass-05 mobile evidence, {orient}  |  source: {LABEL}', fill=(255, 255, 255), font=TFONT)
    y = 40
    for p, row in tiles:
        d.text((8, y + 4), PROF[p], fill=(255, 211, 77), font=FONT)
        y += 30
        x = 8
        for t in row:
            s.paste(t, (x, y))
            x += t.width + 8
        y += th + 26 + 8
    out = os.path.join(OUT, f'sheet_{orient}.jpg')
    s.save(out, quality=88)
    return out


res = {'source': src, 'label': LABEL, 'copied': copied, 'sheets': [sheet('portrait', 640), sheet('landscape', 330)]}
json.dump(res, open(os.path.join(OUT, 'copied.json'), 'w'), indent=1)
for a, b in copied:
    print(f'{a:40s} -> {b}')
print('sheets:', res['sheets'])
