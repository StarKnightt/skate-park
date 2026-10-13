# Contact strip of a recovery_browser.mjs run: evenly spaced frames plus the first frame of every phase, labelled.
#   python tools/sim/recovery_strip.py E:/shots/skate-park/pass-04/recovery [cols]
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

root = sys.argv[1]
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 6
font = ImageFont.load_default()
for run in sorted(os.listdir(os.path.join(root, 'frames'))):
    d = os.path.join(root, 'frames', run)
    log = json.load(open(os.path.join(d, 'log.json')))
    have = sorted(int(f[1:5]) for f in os.listdir(d) if f.endswith('.jpg'))
    if not have:
        continue
    keys = {have[0], have[-1]}
    for i in range(1, len(log)):
        if log[i]['phase'] != log[i - 1]['phase']:
            keys.add(min(have, key=lambda h: abs(h - i)))
    n = cols * 4
    for k in range(n):
        keys.add(have[round(k * (len(have) - 1) / max(1, n - 1))])
    keys = sorted(keys)[: cols * 5]
    tw = 384
    im0 = Image.open(os.path.join(d, f'f{keys[0]:04d}.jpg'))
    th = round(im0.height * tw / im0.width)
    rows = (len(keys) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tw, rows * (th + 18)), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    for j, f in enumerate(keys):
        im = Image.open(os.path.join(d, f'f{f:04d}.jpg')).resize((tw, th))
        x, y = (j % cols) * tw, (j // cols) * (th + 18)
        sheet.paste(im, (x, y + 18))
        l = log[min(f, len(log) - 1)]
        dr.text((x + 4, y + 3), f'f{f:03d} {f / 30:.2f}s {l["phase"]} {l["mode"]} ny {l["ny"]}', fill=(255, 230, 120), font=font)
    out = os.path.join(root, f'{run}_strip.jpg')
    sheet.save(out, quality=88)
    print(out, len(keys), 'frames')
