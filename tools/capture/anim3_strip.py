"""Side-by-side strips for tools/capture/anim3.mjs output.
python tools/capture/anim3_strip.py <out> [flips|dropin|idle|grip] [first last step]
flips: one row per trick (frames relative to the pop), per view -> <out>/strip_flips_<view>.jpg
dropin: one row per run -> <out>/strip_dropin_<run>.jpg
"""
import glob
import os
import sys

from PIL import Image, ImageDraw

out = sys.argv[1]
what = sys.argv[2] if len(sys.argv) > 2 else 'flips'


def cell(path, w, label):
    im = Image.open(path).convert('RGB')
    h = int(im.height * w / im.width)
    im = im.resize((w, h), Image.LANCZOS)
    c = Image.new('RGB', (w, h + 18), (0, 0, 0))
    c.paste(im, (0, 18))
    ImageDraw.Draw(c).text((4, 3), label, fill=(255, 220, 60))
    return c


def grid(rows, w, dst):
    cells = [[cell(p, w, lab) for p, lab in r] for r in rows if r]
    if not cells:
        return
    cw = max(c.width for r in cells for c in r)
    ch = max(c.height for r in cells for c in r)
    ncol = max(len(r) for r in cells)
    img = Image.new('RGB', (cw * ncol, ch * len(cells)), (0, 0, 0))
    for y, r in enumerate(cells):
        for x, c in enumerate(r):
            img.paste(c, (x * cw, y * ch))
    img.save(dst, quality=90)
    print(dst, img.size)


if what == 'flips':
    first, last, step = (int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else (0, 16, 1)
    for view in ('side', 'q35', 'crit'):
        rows = []
        for t in ('ollie', 'kickflip', 'heelflip', 'shuvit', 'treflip'):
            d = os.path.join(out, 'flips', f'{view}_{t}')
            r = []
            for f in range(first, last + 1, step):
                p = os.path.join(d, f'f{f:02d}.jpg')
                if os.path.exists(p):
                    r.append((p, f'{t} +{f}'))
            rows.append(r)
        grid(rows, 200, os.path.join(out, f'strip_flips_{view}_{first}-{last}.jpg'))
elif what == 'dropin':
    step = int(sys.argv[3]) if len(sys.argv) > 3 else 2
    for d in sorted(glob.glob(os.path.join(out, 'dropin', '*'))):
        fs = sorted(glob.glob(os.path.join(d, 'f*.jpg')))[::step]
        name = os.path.basename(d)
        rows = [fs[i:i + 8] for i in range(0, len(fs), 8)]
        grid([[(p, f'{name} {os.path.basename(p)[1:4]}') for p in r] for r in rows], 240, os.path.join(out, f'strip_dropin_{name}.jpg'))
elif what == 'idle':
    for tag in ('front', 'q30', 'qm40'):
        fs = sorted(glob.glob(os.path.join(out, 'idle', f'{tag}_*.jpg')))
        rows = [fs[i:i + 7] for i in range(0, len(fs), 7)]
        grid([[(p, os.path.basename(p)[:-4]) for p in r] for r in rows], 200, os.path.join(out, f'strip_idle_{tag}.jpg'))
elif what == 'grip':
    fs = sorted(glob.glob(os.path.join(out, 'grip', '*.jpg')))
    rows = {}
    for p in fs:
        k = os.path.basename(p).rsplit('_f', 1)[0]
        rows.setdefault(k, []).append((p, os.path.basename(p)[:-4]))
    grid(list(rows.values()), 260, os.path.join(out, 'strip_grip.jpg'))
