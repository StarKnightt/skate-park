"""Large key-frame strip from an anim_check test folder.
python tools/capture/anim_strip.py <dir> <out.jpg> f1 f2 ... [--h 330] [--rows 2]"""
import sys, os, json
from PIL import Image, ImageDraw, ImageFont
args = sys.argv[1:]
h = 330; rows = 2
if '--h' in args: i = args.index('--h'); h = int(args[i + 1]); del args[i:i + 2]
if '--rows' in args: i = args.index('--rows'); rows = int(args[i + 1]); del args[i:i + 2]
d, out, frames = args[0], args[1], [int(x) for x in args[2:]]
log = {}
lp = os.path.join(d, 'log.json')
if os.path.exists(lp): log = {e['f']: e for e in json.load(open(lp))}
ims = []
for n in frames:
    p = os.path.join(d, f'f{n:03d}.jpg')
    if not os.path.exists(p): continue
    im = Image.open(p).convert('RGB')
    ims.append((n, im.resize((int(im.width * h / im.height), h))))
per = (len(ims) + rows - 1) // rows
W = max(sum(im.width for _, im in ims[r * per:(r + 1) * per]) for r in range(rows))
sheet = Image.new('RGB', (W, rows * (h + 18)), (0, 0, 0))
dr = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype('arial.ttf', 14)
except Exception: font = ImageFont.load_default()
for r in range(rows):
    x = 0
    for n, im in ims[r * per:(r + 1) * per]:
        y = r * (h + 18)
        sheet.paste(im, (x, y + 18))
        e = log.get(n, {})
        dr.text((x + 4, y + 2), f"f{n} {e.get('t', 0):.2f}s {' '.join(e.get('ev', []))[:30]}", fill=(255, 230, 190), font=font)
        x += im.width
sheet.save(out, quality=88)
print(out, sheet.size)
