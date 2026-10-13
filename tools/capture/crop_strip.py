"""Strip of centre crops from a frame-stepped capture (review aid).
python crop_strip.py <frames_dir> <out.jpg> <first> <last> [step=1] [x0,y0,x1,y1=400,40,880,680] [thumb_w=160]
"""
import sys
from PIL import Image, ImageDraw, ImageFont

d, out, a, b = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
step = int(sys.argv[5]) if len(sys.argv) > 5 else 1
box = tuple(int(v) for v in sys.argv[6].split(",")) if len(sys.argv) > 6 else (400, 40, 880, 680)
tw = int(sys.argv[7]) if len(sys.argv) > 7 else 160
th = int(tw * (box[3] - box[1]) / (box[2] - box[0]))
fr = list(range(a, b + 1, step))
cols = min(len(fr), 16)
rows = (len(fr) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * (th + 18)), (18, 18, 20))
dr = ImageDraw.Draw(sheet)
font = ImageFont.truetype("arial.ttf", 13)
for k, f in enumerate(fr):
    im = Image.open(f"{d}/f{f:04d}.jpg").crop(box).resize((tw, th), Image.LANCZOS)
    x, y = (k % cols) * tw, (k // cols) * (th + 18)
    sheet.paste(im, (x, y + 18))
    dr.text((x + 3, y + 1), f"f{f:03d}", fill=(255, 230, 200), font=font)
sheet.save(out, quality=88)
print(out, sheet.size)
