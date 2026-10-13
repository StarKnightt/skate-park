"""#55 check: the same shaded 1:1 regions of the h55_* stills across the four times of day, upscaled (nearest).
usage: python media3_h55_crops.py <pass dir> <out.png> [scale]"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

P, OUT = sys.argv[1], sys.argv[2]
K = int(sys.argv[3]) if len(sys.argv) > 3 else 3
W, H = (int(v) for v in os.environ.get("CROP", "160x90").split("x"))
TODS = os.environ.get("TODS", "golden,sunset,blue_hour,noon").split(",")
ROWS = [
    ("c_bowl_coping", (520, 250), "shaded deck + coping"),
    ("c_bowl_coping", (1000, 470), "shaded bowl wall"),
    ("d_ground_low_feet", (700, 560), "ground beside the board"),
    ("c_halfpipe_coping", (900, 520), "half-pipe wall"),
    ("c_stairs_close", (300, 520), "stair risers"),
]
if os.environ.get("ROWS"):
    ROWS = [ROWS[int(i)] for i in os.environ["ROWS"].split(",")]
try:
    FONT = ImageFont.truetype("arial.ttf", 15)
except OSError:
    FONT = ImageFont.load_default()

LW = 210
sheet = Image.new("RGB", (LW + len(TODS) * W * K, 24 + len(ROWS) * H * K), (18, 18, 22))
d = ImageDraw.Draw(sheet)
for j, t in enumerate(TODS):
    d.text((LW + j * W * K + 6, 4), t.replace("_", " "), fill=(255, 220, 120), font=FONT)
for i, (name, (x, y), what) in enumerate(ROWS):
    oy = 24 + i * H * K
    d.text((6, oy + 6), name, fill=(240, 240, 240), font=FONT)
    d.text((6, oy + 26), f"{what}", fill=(200, 200, 200), font=FONT)
    d.text((6, oy + 46), f"x{x} y{y} {W}x{H} at {K}x", fill=(160, 160, 160), font=FONT)
    for j, t in enumerate(TODS):
        im = Image.open(os.path.join(P, "screens", f"h55_{name}_{t}.png")).convert("RGB")
        sheet.paste(im.crop((x, y, x + W, y + H)).resize((W * K, H * K), Image.NEAREST), (LW + j * W * K, oy))
sheet.save(OUT)
print(OUT, sheet.size)
