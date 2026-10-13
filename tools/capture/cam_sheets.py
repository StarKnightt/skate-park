"""Contact sheets for cam_check runs: python cam_sheets.py <run dir> [n per sheet] [cols] [scenario,...]
Picks n evenly spaced frames per scenario and labels them with frame + mode + framing metrics."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

root = sys.argv[1]
n = int(sys.argv[2]) if len(sys.argv) > 2 else 24
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 6
only = sys.argv[4].split(',') if len(sys.argv) > 4 else None
try:
    font = ImageFont.truetype("arial.ttf", 14)
except Exception:
    font = ImageFont.load_default()
for name in sorted(os.listdir(root)):
    d = os.path.join(root, name)
    if not os.path.isdir(d) or (only and name not in only):
        continue
    frames = sorted(f for f in os.listdir(d) if f.startswith('f') and f.endswith('.jpg'))
    if not frames:
        continue
    meta = {}
    mp = os.path.join(d, 'metrics.json')
    if os.path.exists(mp):
        for r in json.load(open(mp))['rows']:
            meta[r['f']] = r
    k = max(1, len(frames) // n)
    pick = frames[::k][:n]
    tw = 320
    im0 = Image.open(os.path.join(d, pick[0]))
    th = int(tw * im0.height / im0.width)
    rows = (len(pick) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tw, rows * (th + 20)), (24, 22, 26))
    dr = ImageDraw.Draw(sheet)
    for i, f in enumerate(pick):
        x, y = (i % cols) * tw, (i // cols) * (th + 20)
        sheet.paste(Image.open(os.path.join(d, f)).convert('RGB').resize((tw, th), Image.LANCZOS), (x, y + 20))
        fi = int(f[1:5])
        m = meta.get(fi)
        lab = f'f{fi:03d}'
        if m and 'box' in m:
            lab += f" {m['mode'][:4]} box{m['box']:.2f} len{m['len']:.2f} {m['side']:.0f}d p{m['lookPitchDeg']:.0f}"
        elif m:
            lab += f" {m['mode'][:4]} sz{m['size']:.2f} hip{m['hipsY']:.0f}% brd{m['boardY']:.0f}% p{m['lookPitchDeg']:.0f}"
        dr.text((x + 4, y + 3), lab, fill=(255, 236, 200), font=font)
    out = os.path.join(root, f'sheet_{name}.jpg')
    sheet.save(out, quality=86)
    print(out, sheet.size)
