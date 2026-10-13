"""Paint the skater's face textures (front planar projection of the head).
UV mapping used by build_skater.py:  u = 0.5 + x / S,  v = 0.5 + (y - YC) / S   (metres, glTF axes)
python paint_face.py <neutral_out.png> [webp_dir]
  webp_dir: also writes face_{neutral,focus,wide,grin,grimace}.webp (1024x1024, same layout as the GLB face texture)
Back-facing head vertices sample uv (0.5, 0.03): keep that pixel plain skin.
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S, YC = 0.26, 1.640
N = 1024
SS = 3  # supersampling
W = N * SS
SKIN = (233, 180, 143)
LINE = (38, 24, 17, 255)
BROW = (59, 38, 24, 255)
EXPRESSIONS = ("neutral", "focus", "wide", "grin", "grimace")
EYE_Y, EYE_X = 1.651, 0.0355
EW, EH = 0.0275, 0.0195
MOUTH_Y = 1.5885

# per-expression parameters: eyes, brows, blush alpha
EXPR = {
    "neutral": dict(eye=dict(), brow=dict(), blush=105),
    "focus": dict(eye=dict(top=0.60, bot=0.78, slant=0.0016, lid_w=1.25, iris_dy=0.0006), brow=dict(dy=-0.0016, inner=-0.0030, thick=1.08),
                  blush=92),
    "wide": dict(eye=dict(top=1.38, bot=1.30, w=1.06, iris=0.86, dy=0.0006), brow=dict(dy=0.0058, arch=1.55, inner=0.0010), blush=96),
    "grin": dict(eye=dict(top=0.92, bot=-0.34, iris_dy=-0.0016, cheek=True), brow=dict(dy=0.0016, arch=1.2), blush=150),
    "grimace": dict(eye=dict(squeeze=True), brow=dict(dy=-0.0012, inner=-0.0062, outer=0.0016, x0=0.0125, thick=1.15), blush=128),
}


def px(x, y):
    return ((0.5 + x / S) * W, (1.0 - (0.5 + (y - YC) / S)) * W)


def m(v):
    return v / S * W


class Canvas:
    def __init__(self):
        self.img = Image.new("RGBA", (W, W), SKIN + (255,))

    @staticmethod
    def layer():
        return Image.new("RGBA", (W, W), (0, 0, 0, 0))

    def paste(self, l, blur=0):
        if blur:
            l = l.filter(ImageFilter.GaussianBlur(blur * SS))
        self.img = Image.alpha_composite(self.img, l)


def ell(d, x, y, rx, ry, fill):
    cx, cy = px(x, y)
    d.ellipse([cx - m(rx), cy - m(ry), cx + m(rx), cy + m(ry)], fill=fill)


def curve(fn, a0, a1, n=40):
    return [px(*fn(a)) for a in np.linspace(a0, a1, n)]


# ----------------------------------------------------------------------------- skin
def skin_base(c, blush):
    # sun-warmed mid-face (cheeks + nose band)
    l = c.layer(); d = ImageDraw.Draw(l)
    ell(d, 0, 1.622, 0.060, 0.020, (238, 146, 116, 46))
    c.paste(l, blur=12)
    # cheeks blush
    l = c.layer(); d = ImageDraw.Draw(l)
    for s in (1, -1):
        ell(d, s * 0.050, 1.620, 0.0145, 0.0085, (240, 124, 108, blush))
    c.paste(l, blur=9)
    # warmer nose tip + soft under-nose shade
    l = c.layer(); d = ImageDraw.Draw(l)
    ell(d, 0, 1.6270, 0.0095, 0.0080, (236, 136, 114, 82))
    c.paste(l, blur=7)
    l = c.layer(); d = ImageDraw.Draw(l)
    ell(d, 0, 1.6125, 0.0055, 0.0022, (206, 140, 112, 60))
    c.paste(l, blur=5)
    # ears glow warm red in low sun (outer ear + darker bowl)
    l = c.layer(); d = ImageDraw.Draw(l)
    for s in (1, -1):
        ell(d, s * 0.097, 1.641, 0.0135, 0.031, (228, 116, 98, 155))
    c.paste(l, blur=5)
    l = c.layer(); d = ImageDraw.Draw(l)
    for s in (1, -1):
        ell(d, s * 0.100, 1.639, 0.0060, 0.016, (196, 90, 78, 100))
    c.paste(l, blur=4)
    # freckles (fixed seed: identical in every expression)
    rng = np.random.default_rng(7)
    l = c.layer(); d = ImageDraw.Draw(l)
    for s in (1, -1):
        for i in range(7):
            x = s * (0.030 + rng.uniform(0, 0.032)); y = 1.628 + rng.uniform(-0.007, 0.007)
            r = rng.uniform(0.0007, 0.0012)
            ell(d, x, y, r, r, (178, 112, 82, 170))
    c.paste(l, blur=0.6)


def brim_shadow(c):
    """Soft shadow band under the cap brim (forehead + temples), warm-shifted like shaded skin."""
    a = np.zeros((W, W), np.float32)
    ys = YC + (0.5 - (np.arange(W) + 0.5) / W) * S       # metres per row
    xs = ((np.arange(W) + 0.5) / W - 0.5) * S
    rows = np.clip((ys - 1.679) / (1.712 - 1.679), 0, 1) ** 1.35
    cols = 1.0 - np.clip((np.abs(xs) - 0.085) / 0.04, 0, 1)
    a[:] = (rows[:, None] * cols[None, :]) * 0.58
    l = Image.new("RGBA", (W, W), (152, 88, 80, 0))
    l.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    c.paste(l, blur=2)


# ----------------------------------------------------------------------------- eyes
def eye(c, s, e):
    if e.get("squeeze"):
        return squeezed_eye(c, s)
    ex, ey = px(s * EYE_X, EYE_Y + e.get("dy", 0.0))
    ew = m(EW / 2) * e.get("w", 1.0)
    top_h = m(EH / 2) * 1.05 * e.get("top", 1.0)
    bot_h = m(EH / 2) * 0.80 * e.get("bot", 1.0)   # negative: lower lid arches up (happy squint)
    slant = m(e.get("slant", 0.0))                  # >0 lowers the upper lid on the nose side

    def top_pt(a, k=1.0, grow=1.0):
        return (ex + np.cos(a) * ew * grow, ey - np.sin(a) * top_h * k + slant * (-s * np.cos(a)) * np.sin(a) * 1.6)

    t = np.linspace(0, np.pi, 48)
    top = [top_pt(a) for a in t]
    bot = [(ex - np.cos(a) * ew, ey + np.sin(a) * bot_h) for a in t]
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).polygon(top + bot, fill=255)
    l = c.layer(); d = ImageDraw.Draw(l)
    d.polygon(top + bot, fill=(250, 247, 240, 255))
    # iris + pupil + highlights, clipped by the eye opening
    ir = m(0.0086) * e.get("iris", 1.0)
    ix, iy = ex - s * m(0.0006), ey + m(0.0004) + m(e.get("iris_dy", 0.0))
    il = c.layer(); di = ImageDraw.Draw(il)
    di.ellipse([ix - ir, iy - ir * 1.08, ix + ir, iy + ir * 1.08], fill=(58, 34, 22, 255))
    di.ellipse([ix - ir * 0.78, iy - ir * 0.25, ix + ir * 0.78, iy + ir * 0.95], fill=(112, 68, 40, 255))
    pr = ir * 0.48
    di.ellipse([ix - pr, iy - pr * 1.1, ix + pr, iy + pr * 1.1], fill=(18, 10, 6, 255))
    il = il.filter(ImageFilter.GaussianBlur(0.8 * SS))
    di = ImageDraw.Draw(il)
    hr = m(0.0028) * e.get("iris", 1.0)
    hx, hy = ix - m(0.0035), iy - m(0.0040)
    di.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=(255, 255, 255, 255))
    hr2 = m(0.0013); hx2, hy2 = ix + m(0.0038), iy + m(0.0035)
    di.ellipse([hx2 - hr2, hy2 - hr2, hx2 + hr2, hy2 + hr2], fill=(255, 255, 255, 220))
    l = Image.alpha_composite(l, Image.composite(il, c.layer(), mask))
    # upper lid line + outer lash flick
    d = ImageDraw.Draw(l)
    lid = [top_pt(a, 1.07, 1.04) for a in np.linspace(-0.05, np.pi + 0.05, 48)]
    d.line(lid, fill=LINE, width=int(m(0.0021) * e.get("lid_w", 1.0)), joint="curve")
    ox, oy = top_pt(0 if s > 0 else np.pi, 1.0, 1.02)
    oy -= m(EH * 0.05)
    d.line([(ox, oy), (ox + s * m(0.0042), oy - m(0.0030))], fill=LINE, width=int(m(0.0018)))
    # lower lid
    if bot_h > 0:
        low = [(ex - np.cos(a) * ew * 0.9, ey + np.sin(a) * bot_h * 1.07) for a in np.linspace(0.25, np.pi - 0.25, 24)]
        d.line(low, fill=(160, 98, 78, 150), width=int(m(0.0009)))
    else:
        low = [(ex - np.cos(a) * ew * 0.97, ey + np.sin(a) * bot_h * 1.05) for a in np.linspace(0.1, np.pi - 0.1, 24)]
        d.line(low, fill=(120, 64, 50, 220), width=int(m(0.0014)), joint="curve")
    c.paste(l, blur=0.35)
    if e.get("cheek"):
        # cheeks pushed up under the eyes
        l = c.layer(); d = ImageDraw.Draw(l)
        arc = curve(lambda a: (s * (EYE_X + a * 0.013), EYE_Y - 0.0118 + 0.0026 * (1 - a * a)), -1, 1)
        d.line(arc, fill=(196, 116, 96, 120), width=int(m(0.0011)), joint="curve")
        c.paste(l, blur=1.2)


def squeezed_eye(c, s):
    """Eye squeezed shut: thick lid chevron pointing at the nose + crease ticks."""
    ex, ey = s * EYE_X, EYE_Y
    l = c.layer(); d = ImageDraw.Draw(l)
    upper = curve(lambda a: (ex + s * EW * 0.52 * (1 - 2 * a), ey + 0.0042 - 0.0050 * a - 0.0012 * np.sin(a * np.pi)), 0, 1, 32)
    lower = curve(lambda a: (ex - s * EW * 0.46 + s * EW * 0.94 * a, ey - 0.0008 - 0.0036 * a + 0.0006 * np.sin(a * np.pi)), 0, 1, 32)
    d.line(upper, fill=LINE, width=int(m(0.0030)), joint="curve")
    d.line(lower, fill=LINE, width=int(m(0.0023)), joint="curve")
    for k in range(2):
        x0 = ex + s * (EW * 0.62 + 0.0012 * k); y0 = ey + 0.0030 - 0.0046 * k
        d.line([px(x0, y0), px(x0 + s * 0.0046, y0 + 0.0010 - 0.0020 * k)], fill=(150, 88, 70, 200), width=int(m(0.0010)))
    arc = curve(lambda a: (ex + a * 0.012, ey - 0.0085 - 0.0018 * (1 - a * a)), -1, 1)
    d.line(arc, fill=(180, 104, 86, 150), width=int(m(0.0010)), joint="curve")
    c.paste(l, blur=0.4)


def brow(c, s, b):
    l = c.layer(); d = ImageDraw.Draw(l)
    x0 = b.get("x0", 0.016)
    for a in np.linspace(0, 1, 32):
        x = s * (x0 + a * 0.040)
        y = (1.6745 + b.get("dy", 0) + b.get("arch", 1.0) * 0.0042 * np.sin(a * np.pi * 0.95) - 0.002 * a
             + b.get("inner", 0) * (1 - a) ** 1.5 + b.get("outer", 0) * a)
        w = 0.0050 * (1 - 0.55 * a) * b.get("thick", 1.0)
        cx, cy = px(x, y)
        d.ellipse([cx - m(w) * 0.6, cy - m(w) * 0.5, cx + m(w) * 0.6, cy + m(w) * 0.5], fill=BROW)
    c.paste(l, blur=0.4)


def glabella(c, strength):
    l = c.layer(); d = ImageDraw.Draw(l)
    for s in (1, -1):
        d.line([px(s * 0.0062, 1.6650), px(s * 0.0048, 1.6735)], fill=(170, 100, 80, int(170 * strength)), width=int(m(0.0010)))
    c.paste(l, blur=0.8)


# ----------------------------------------------------------------------------- mouths
def mouth_neutral(c):
    l = c.layer(); d = ImageDraw.Draw(l)
    d.line(curve(lambda a: (a * 0.0125, MOUTH_Y + 0.0032 * a * a - 0.0007), -1, 1, 30), fill=(128, 56, 46, 255),
           width=int(m(0.0019)), joint="curve")
    ell(d, 0, 1.5852, 0.0065, 0.0018, (214, 128, 112, 110))
    c.paste(l, blur=0.5)


def mouth_focus(c):
    l = c.layer(); d = ImageDraw.Draw(l)
    d.line(curve(lambda a: (a * 0.0108, MOUTH_Y - 0.0004 + 0.0007 * a * a - 0.0005 * a ** 4), -1, 1, 30),
           fill=(118, 52, 44, 255), width=int(m(0.0021)), joint="curve")
    ell(d, 0, 1.5850, 0.0055, 0.0014, (200, 118, 104, 120))
    c.paste(l, blur=0.5)
    l = c.layer(); d = ImageDraw.Draw(l)
    ell(d, 0, 1.5818, 0.0050, 0.0012, (190, 120, 98, 70))   # pressed lower lip shade
    c.paste(l, blur=1.5)


def mouth_wide(c):
    l = c.layer(); d = ImageDraw.Draw(l)
    ell(d, 0, 1.5866, 0.0060, 0.0072, (176, 84, 74, 255))   # lip ring
    ell(d, 0, 1.5864, 0.0047, 0.0059, (82, 30, 28, 255))    # open mouth
    ell(d, 0, 1.5830, 0.0032, 0.0020, (168, 76, 72, 255))   # tongue
    c.paste(l, blur=0.45)
    l = c.layer(); d = ImageDraw.Draw(l)
    ell(d, 0.0016, 1.5801, 0.0018, 0.0007, (240, 190, 170, 120))
    c.paste(l, blur=0.6)


def _mouth_shape(c, up, lo, n=48):
    a = np.linspace(-1, 1, n)
    top = [px(*up(v)) for v in a]
    bot = [px(*lo(v)) for v in a[::-1]]
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).polygon(top + bot, fill=255)
    return top, bot, mask


def mouth_grin(c):
    hw = 0.0205
    up = lambda a: (a * hw, MOUTH_Y + 0.0012 + 0.0040 * a * a)
    lo = lambda a: (a * hw, MOUTH_Y + 0.0012 + 0.0040 * a * a - 0.0088 * (1 - a * a) ** 1.2)
    top, bot, mask = _mouth_shape(c, up, lo)
    inner = c.layer(); d = ImageDraw.Draw(inner)
    d.rectangle([0, 0, W, W], fill=(104, 36, 34, 255))
    ell(d, 0, MOUTH_Y - 0.0062, 0.0105, 0.0040, (176, 78, 76, 255))                   # tongue
    d.polygon([px(*up(v)) for v in np.linspace(-0.92, 0.92, 40)] +
              [px(v * hw * 0.92, MOUTH_Y + 0.0012 + 0.0040 * v * v - 0.0036 * (1 - v * v)) for v in np.linspace(0.92, -0.92, 40)],
              fill=(248, 244, 234, 255))                                               # upper teeth
    l = Image.composite(inner, c.layer(), mask)
    d = ImageDraw.Draw(l)
    d.line(top, fill=(112, 46, 40, 255), width=int(m(0.0016)), joint="curve")
    d.line(bot + [bot[0]], fill=(120, 52, 44, 255), width=int(m(0.0013)), joint="curve")
    for s in (1, -1):  # upturned corners
        d.line([px(s * hw * 0.98, MOUTH_Y + 0.0050), px(s * (hw + 0.0024), MOUTH_Y + 0.0068)], fill=(120, 52, 44, 255),
               width=int(m(0.0014)))
    c.paste(l, blur=0.45)
    l = c.layer(); d = ImageDraw.Draw(l)
    ell(d, 0, MOUTH_Y - 0.0100, 0.0080, 0.0016, (214, 128, 112, 110))                 # lower lip warmth
    for s in (1, -1):  # smile folds
        d.line(curve(lambda a: (s * (0.0215 + 0.0040 * a), 1.6040 - 0.0110 * a - 0.0016 * np.sin(a * np.pi)), 0, 1, 20),
               fill=(196, 120, 98, 110), width=int(m(0.0011)), joint="curve")
    c.paste(l, blur=1.0)


def mouth_grimace(c):
    hw = 0.0195
    up = lambda a: (a * hw, MOUTH_Y + 0.0026 - 0.0030 * a ** 4)
    lo = lambda a: (a * hw, MOUTH_Y - 0.0048 + 0.0044 * a ** 4)
    top, bot, mask = _mouth_shape(c, up, lo)
    inner = c.layer(); d = ImageDraw.Draw(inner)
    d.rectangle([0, 0, W, W], fill=(244, 238, 226, 255))
    for s in (1, -1):  # dark mouth corners behind the teeth
        d.polygon([px(s * hw, MOUTH_Y - 0.0004), px(s * hw * 0.80, MOUTH_Y + 0.0018), px(s * hw * 0.80, MOUTH_Y - 0.0030)],
                  fill=(92, 34, 32, 255))
    mid = [px(v * hw, MOUTH_Y - 0.0011 + 0.0007 * v ** 4) for v in np.linspace(-0.95, 0.95, 40)]
    d.line(mid, fill=(120, 72, 64, 255), width=int(m(0.0011)), joint="curve")
    for k in range(-4, 5):  # tooth gaps
        x = k * 0.0036
        d.line([px(x, MOUTH_Y + 0.0024), px(x, MOUTH_Y - 0.0046)], fill=(196, 182, 168, 255), width=int(m(0.0005)))
    l = Image.composite(inner, c.layer(), mask)
    d = ImageDraw.Draw(l)
    d.line(top, fill=(112, 46, 40, 255), width=int(m(0.0018)), joint="curve")
    d.line(bot + [bot[0]], fill=(112, 46, 40, 255), width=int(m(0.0016)), joint="curve")
    c.paste(l, blur=0.45)
    l = c.layer(); d = ImageDraw.Draw(l)
    ell(d, 0, MOUTH_Y - 0.0068, 0.0110, 0.0016, (206, 118, 104, 110))                 # stretched lower lip
    for s in (1, -1):  # strained corner lines
        d.line(curve(lambda a: (s * (hw + 0.0010 + 0.0016 * a), MOUTH_Y + 0.0060 - 0.0110 * a), 0, 1, 16),
               fill=(186, 108, 90, 120), width=int(m(0.0010)), joint="curve")
    c.paste(l, blur=1.0)


MOUTHS = {"neutral": mouth_neutral, "focus": mouth_focus, "wide": mouth_wide, "grin": mouth_grin, "grimace": mouth_grimace}


def paint(kind):
    p = EXPR[kind]
    c = Canvas()
    skin_base(c, p["blush"])
    brim_shadow(c)
    for s in (1, -1):
        eye(c, s, p["eye"])
        brow(c, s, p["brow"])
    if kind == "grimace":
        glabella(c, 1.0)
    elif kind == "focus":
        glabella(c, 0.45)
    MOUTHS[kind](c)
    out = c.img.resize((N, N), Image.LANCZOS).convert("RGB")
    assert out.getpixel((N // 2, int(N * 0.97))) == SKIN, "back-of-head uv pixel must stay plain skin"
    return out


if __name__ == "__main__":
    paint("neutral").save(sys.argv[1])
    print("face texture", sys.argv[1])
    if len(sys.argv) > 2:
        os.makedirs(sys.argv[2], exist_ok=True)
        for kind in EXPRESSIONS:
            path = os.path.join(sys.argv[2], "face_%s.webp" % kind)
            paint(kind).save(path, "WEBP", quality=90, method=6)
            print("face texture", path)
