# App icons (original artwork, drawn here): golden-hour sky gradient, a striped setting sun and a skateboard mid-ollie.
# python tools/assets/make_icons.py [out_dir=public/icons]
# Maskable: full-bleed background, every motif inside the central safe circle (radius 0.4 of the size).
import math
import os
import sys
from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'icons')
SS = 4  # supersampling

SKY = [(0.0, (255, 206, 140)), (0.55, (246, 166, 146)), (1.0, (176, 152, 214))]
SUN = (255, 243, 205)
PLUM = (59, 42, 47)
CREAM = (255, 241, 214)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def sky(y):
    for (y0, c0), (y1, c1) in zip(SKY, SKY[1:]):
        if y <= y1:
            return lerp(c0, c1, (y - y0) / (y1 - y0))
    return SKY[-1][1]


def draw(size, scale):
    S = size * SS
    img = Image.new('RGB', (S, S))
    px = ImageDraw.Draw(img)
    for y in range(S):
        px.line([(0, y), (S, y)], fill=sky(y / (S - 1)))
    d = ImageDraw.Draw(img, 'RGBA')
    u = lambda v: v * S
    cx, cy = 0.5, 0.5

    def P(x, y):  # motif coordinates scaled about the centre
        return (u(cx + (x - cx) * scale), u(cy + (y - cy) * scale))

    # sun: soft glow, disc, retro stripes cut in the sky colour below its middle
    sx, sy, sr = 0.5, 0.43, 0.215
    for k in range(10, 0, -1):
        r = sr * (1 + 0.035 * k)
        a = int(14 + 3 * (10 - k))
        x0, y0 = P(sx - r, sy - r); x1, y1 = P(sx + r, sy + r)
        d.ellipse([x0, y0, x1, y1], fill=(255, 226, 170, a))
    x0, y0 = P(sx - sr, sy - sr); x1, y1 = P(sx + sr, sy + sr)
    d.ellipse([x0, y0, x1, y1], fill=SUN)
    ccx, ccy, rr = P(sx, sy)[0], P(sx, sy)[1], sr * scale * S
    for yy, h in [(0.47, 0.018), (0.515, 0.024), (0.565, 0.03)]:
        ya, yb = P(0, yy)[1], P(0, yy + h)[1]
        for y in range(int(ya), int(yb) + 1):
            hw = math.sqrt(max(0.0, rr * rr - (y - ccy) ** 2)) + 1
            d.line([(ccx - hw, y), (ccx + hw, y)], fill=sky(y / (S - 1)))

    # skateboard mid-ollie: kicked deck (polyline with round caps), trucks, wheels; tilted nose-up
    ang = math.radians(-14)
    bx, by, half = 0.5, 0.665, 0.29

    def B(x, y):  # board space (x along the deck, y down) -> icon
        rx = x * math.cos(ang) - y * math.sin(ang)
        ry = x * math.sin(ang) + y * math.cos(ang)
        return P(bx + rx, by + ry)

    w = 0.052 * scale * S
    deck = [(-half, -0.045), (-half + 0.07, 0.0), (half - 0.07, 0.0), (half, -0.045)]
    pts = [B(x, y) for x, y in deck]
    d.line(pts, fill=PLUM, width=int(w), joint='curve')
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=PLUM)
    for tx in (-0.17, 0.17):
        tr = [B(tx - 0.045, 0.02), B(tx + 0.045, 0.02), B(tx + 0.022, 0.06), B(tx - 0.022, 0.06)]
        d.polygon(tr, fill=PLUM)
        wr = 0.043 * scale * S
        for wx in (tx - 0.035, tx + 0.035):
            c = B(wx, 0.083)
            d.ellipse([c[0] - wr, c[1] - wr, c[0] + wr, c[1] + wr], fill=PLUM)
            r2 = wr * 0.58
            d.ellipse([c[0] - r2, c[1] - r2, c[0] + r2, c[1] + r2], fill=CREAM)
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size, scale in [('icon-192.png', 192, 1.0), ('icon-512.png', 512, 1.0),
                              ('icon-maskable-512.png', 512, 0.86), ('apple-touch-icon-180.png', 180, 0.94)]:
        draw(size, scale).save(os.path.join(OUT, name), optimize=True)
        print(name, os.path.getsize(os.path.join(OUT, name)), 'bytes')


if __name__ == '__main__':
    main()
