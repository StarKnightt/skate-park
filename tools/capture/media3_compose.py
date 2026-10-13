"""Pass-3 composite stills for #44 (kickflip / heelflip / shove-it legs at board height, same frames after the pop).
python media3_compose.py <pass_dir>
Needs frames/clip26..28_*_board_height (run before the raw frames are deleted). Writes screens/h44_*.png.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

P = sys.argv[1]
FR, SC = os.path.join(P, "frames"), os.path.join(P, "screens")
TRICKS = [("kickflip", "clip26_kickflip_board_height"), ("heelflip", "clip27_heelflip_board_height"), ("shove-it", "clip28_shuvit_board_height")]
FONT = ImageFont.truetype("arialbd.ttf", 22)
SMALL = ImageFont.truetype("arialbd.ttf", 17)
CROP = (400, 30, 880, 690)  # 480 x 660 around the board-tracking camera's centre


def pops(clip):
    ev = json.load(open(os.path.join(FR, clip, "events.json")))
    return [e["frame"] for e in ev if e["type"] == "pop"]


def frame(clip, f):
    return Image.open(os.path.join(FR, clip, "f%04d.jpg" % f)).convert("RGB").crop(CROP)


def label(im, txt, font=FONT):
    d = ImageDraw.Draw(im)
    w = d.textlength(txt, font=font)
    d.rectangle([0, 0, w + 14, font.size + 10], fill=(0, 0, 0))
    d.text((7, 4), txt, fill=(255, 236, 200), font=font)


for seg, view in [(0, "side"), (1, "q35")]:
    # 1) 1:1 side by side at pop+6 (top of the pop, legs at their widest for the flips)
    k = 6
    cw, ch = CROP[2] - CROP[0], CROP[3] - CROP[1]
    out = Image.new("RGB", (3 * cw + 2 * 6, ch), (20, 18, 22))
    for j, (name, clip) in enumerate(TRICKS):
        p = pops(clip)[seg]
        im = frame(clip, p + k)
        label(im, f"{name}  {clip[:6]} f{p + k:03d} (pop+{k})")
        out.paste(im, (j * (cw + 6), 0))
    fn = os.path.join(SC, f"h44_flip_peak_compare_{view}.png")
    out.save(fn)
    print(fn, out.size)
    # 2) grid: rows = tricks, columns = pop+2 .. pop+12 every 2 frames
    ks = [2, 4, 6, 8, 10, 12]
    tw, th = 240, 330
    head = 34
    g = Image.new("RGB", (110 + len(ks) * tw, head + 3 * th), (20, 18, 22))
    d = ImageDraw.Draw(g)
    for c, kk in enumerate(ks):
        d.text((110 + c * tw + 8, 7), f"pop+{kk}  ({kk / 30:.2f} s)", fill=(170, 230, 255), font=SMALL)
    for r, (name, clip) in enumerate(TRICKS):
        p = pops(clip)[seg]
        d.text((8, head + r * th + th // 2 - 10), name, fill=(255, 236, 200), font=SMALL)
        for c, kk in enumerate(ks):
            im = frame(clip, p + kk).resize((tw, th), Image.LANCZOS)
            g.paste(im, (110 + c * tw, head + r * th))
            d.text((110 + c * tw + 5, head + r * th + 4), f"f{p + kk:03d}", fill=(255, 255, 255), font=SMALL)
    fn = os.path.join(SC, f"h44_flip_compare_grid_{view}.png")
    g.save(fn)
    print(fn, g.size)
