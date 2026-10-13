"""Labelled review grids of screenshots (review aid).
python review_grid.py <out_prefix> <cols> <cell_w> <img> [img ...]
Writes <out_prefix>_NN.jpg grids of cols x cols cells (cell_w wide, 16:9 or the image's own aspect).
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

out, cols, cw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
imgs = sys.argv[4:]
per = cols * cols
font = ImageFont.truetype("arialbd.ttf", 15)
for gi in range(0, len(imgs), per):
    chunk = imgs[gi:gi + per]
    ims = [Image.open(p).convert("RGB") for p in chunk]
    ch = max(int(cw * im.height / im.width) for im in ims)
    rows = (len(chunk) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw, rows * (ch + 20)), (16, 16, 18))
    dr = ImageDraw.Draw(sheet)
    for k, (p, im) in enumerate(zip(chunk, ims)):
        th = int(cw * im.height / im.width)
        x, y = (k % cols) * cw, (k // cols) * (ch + 20)
        sheet.paste(im.resize((cw, th), Image.LANCZOS), (x, y + 20))
        dr.text((x + 4, y + 2), os.path.basename(p), fill=(255, 230, 190), font=font)
    path = f"{out}_{gi // per + 1:02d}.jpg"
    sheet.save(path, quality=88)
    print(path, sheet.size)
