"""Tile images into a labelled contact sheet. python sheet.py out.jpg cols thumbW img1 img2 ..."""
import sys, os
from PIL import Image, ImageDraw, ImageFont

out, cols, tw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
ims = [Image.open(f).convert("RGB") for f in files]
th = int(tw * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * (th + 22)), (30, 26, 30))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("arial.ttf", 15)
except Exception:
    font = ImageFont.load_default()
for i, (im, f) in enumerate(zip(ims, files)):
    x, y = (i % cols) * tw, (i // cols) * (th + 22)
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + 22))
    d.text((x + 6, y + 3), os.path.splitext(os.path.basename(f))[0], fill=(255, 240, 220), font=font)
sheet.save(out, quality=88)
print(out, sheet.size)
