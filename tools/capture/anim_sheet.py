"""Contact sheet for an anim_check test folder: frames labelled with frame number, time, mode/phase and events.
python tools/capture/anim_sheet.py E:/shots/skate-park/pass-02/dev/anim/kickflip [cols] [thumbH]"""
import sys, os, json, glob
from PIL import Image, ImageDraw, ImageFont

d = sys.argv[1]
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 8
th = int(sys.argv[3]) if len(sys.argv) > 3 else 260
log = {e["f"]: e for e in json.load(open(os.path.join(d, "log.json")))}
files = sorted(glob.glob(os.path.join(d, "f*.jpg")))
ims = []
for f in files:
    im = Image.open(f).convert("RGB")
    ims.append((int(os.path.basename(f)[1:4]), im.resize((int(im.width * th / im.height), th), Image.LANCZOS)))
tw = max(im.width for _, im in ims)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * (th + 34)), (24, 22, 26))
dr = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("arial.ttf", 13)
except Exception:
    font = ImageFont.load_default()
for k, (fi, im) in enumerate(ims):
    x, y = (k % cols) * tw, (k // cols) * (th + 34)
    sheet.paste(im, (x + (tw - im.width) // 2, y + 34))
    e = log.get(fi, {})
    l1 = f"f{fi} {e.get('t', 0):.2f}s {e.get('mode', '')}/{e.get('phase', '')} {e.get('flip') or ''}{e.get('grind') or ''}"
    l2 = " ".join(e.get("ev", []))[:46]
    dr.text((x + 4, y + 2), l1, fill=(255, 238, 210), font=font)
    dr.text((x + 4, y + 17), l2, fill=(255, 200, 120), font=font)
out = d.rstrip("/\\") + "_sheet.jpg"
sheet.save(out, quality=86)
print(out, sheet.size)
