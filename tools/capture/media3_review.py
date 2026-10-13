"""Review grid of frames from one frame-stepped capture (review aid, PIL only).
python media3_review.py <frames_dir> <out.jpg> <start> <end> <step> [cols] [cell_w]
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

d, out, a, b, step = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
cols = int(sys.argv[6]) if len(sys.argv) > 6 else 6
cw = int(sys.argv[7]) if len(sys.argv) > 7 else 320
files = [os.path.join(d, "f%04d.jpg" % i) for i in range(a, b + 1, step) if os.path.exists(os.path.join(d, "f%04d.jpg" % i))]
font = ImageFont.truetype("arialbd.ttf", 14)
ims = [Image.open(p).convert("RGB") for p in files]
ch = int(cw * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cw, rows * ch), (16, 16, 18))
dr = ImageDraw.Draw(sheet)
for k, (p, im) in enumerate(zip(files, ims)):
    x, y = (k % cols) * cw, (k // cols) * ch
    sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y))
    dr.rectangle([x, y, x + 52, y + 17], fill=(0, 0, 0))
    dr.text((x + 3, y + 1), os.path.basename(p)[:5], fill=(255, 230, 190), font=font)
sheet.save(out, quality=88)
print(out, sheet.size, len(ims))
