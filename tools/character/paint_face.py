"""Paint the skater's face texture (front planar projection of the head).
UV mapping used by build_skater.py:  u = 0.5 + x / S,  v = 0.5 + (y - YC) / S   (metres, glTF axes)
python paint_face.py <out.png>
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S, YC = 0.26, 1.640
N = 1024
SS = 3  # supersampling
W = N * SS
SKIN = (233, 180, 143)


def px(x, y):
    return ((0.5 + x / S) * W, (1.0 - (0.5 + (y - YC) / S)) * W)


def m(v):
    return v / S * W


img = Image.new("RGBA", (W, W), SKIN + (255,))


def layer():
    return Image.new("RGBA", (W, W), (0, 0, 0, 0))


def paste(l, blur=0):
    global img
    if blur:
        l = l.filter(ImageFilter.GaussianBlur(blur * SS))
    img = Image.alpha_composite(img, l)


# soft warm shading: cheeks blush + under-nose + chin
l = layer(); d = ImageDraw.Draw(l)
for s in (1, -1):
    cx, cy = px(s * 0.050, 1.620)
    d.ellipse([cx - m(0.014), cy - m(0.008), cx + m(0.014), cy + m(0.008)], fill=(240, 128, 112, 105))
paste(l, blur=9)
l = layer(); d = ImageDraw.Draw(l)
cx, cy = px(0, 1.6125)
d.ellipse([cx - m(0.0055), cy - m(0.0022), cx + m(0.0055), cy + m(0.0022)], fill=(206, 140, 112, 60))
paste(l, blur=5)

# freckles
rng = np.random.default_rng(7)
l = layer(); d = ImageDraw.Draw(l)
for s in (1, -1):
    for i in range(7):
        x = s * (0.030 + rng.uniform(0, 0.032)); y = 1.628 + rng.uniform(-0.007, 0.007)
        r = m(rng.uniform(0.0007, 0.0012))
        cx, cy = px(x, y)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(178, 112, 82, 170))
paste(l, blur=0.6)

# eyes
EYE_Y, EYE_X = 1.651, 0.0355
EW, EH = 0.0275, 0.0195
for s in (1, -1):
    ex, ey = px(s * EYE_X, EYE_Y)
    # almond-shaped sclera (polygon from two arcs)
    t = np.linspace(0, np.pi, 40)
    top = [(ex + np.cos(a) * m(EW / 2), ey - np.sin(a) * m(EH / 2) * 1.05) for a in t]
    bot = [(ex - np.cos(a) * m(EW / 2), ey + np.sin(a) * m(EH / 2) * 0.80) for a in t]
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).polygon(top + bot, fill=255)
    l = layer(); d = ImageDraw.Draw(l)
    d.polygon(top + bot, fill=(250, 247, 240, 255))
    # iris (clipped by sclera), slightly up
    ir = m(0.0086); ix, iy = ex - s * m(0.0006), ey + m(0.0004)
    il = layer(); di = ImageDraw.Draw(il)
    di.ellipse([ix - ir, iy - ir * 1.08, ix + ir, iy + ir * 1.08], fill=(58, 34, 22, 255))
    di.ellipse([ix - ir * 0.78, iy - ir * 0.25, ix + ir * 0.78, iy + ir * 0.95], fill=(112, 68, 40, 255))
    pr = ir * 0.48
    di.ellipse([ix - pr, iy - pr * 1.1, ix + pr, iy + pr * 1.1], fill=(18, 10, 6, 255))
    il = il.filter(ImageFilter.GaussianBlur(0.8 * SS))
    l = Image.alpha_composite(l, Image.composite(il, layer(), mask))
    # highlights
    d = ImageDraw.Draw(l)
    hr = m(0.0028)
    hx, hy = ix - m(0.0035), iy - m(0.0040)
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=(255, 255, 255, 255))
    hr2 = m(0.0013); hx2, hy2 = ix + m(0.0038), iy + m(0.0035)
    d.ellipse([hx2 - hr2, hy2 - hr2, hx2 + hr2, hy2 + hr2], fill=(255, 255, 255, 220))
    # upper lid line + outer lash flick
    lid = [(ex + np.cos(a) * m(EW / 2 * 1.04), ey - np.sin(a) * m(EH / 2) * 1.07) for a in np.linspace(-0.05, np.pi + 0.05, 40)]
    d.line(lid, fill=(38, 24, 17, 255), width=int(m(0.0021)), joint="curve")
    ox = ex + s * m(EW / 2 * 1.02); oy = ey - m(EH * 0.05)
    d.line([(ox, oy), (ox + s * m(0.0042), oy - m(0.0030))], fill=(38, 24, 17, 255), width=int(m(0.0018)))
    # lower lid hint
    low = [(ex - np.cos(a) * m(EW / 2 * 0.9), ey + np.sin(a) * m(EH / 2) * 0.86) for a in np.linspace(0.25, np.pi - 0.25, 20)]
    d.line(low, fill=(160, 98, 78, 150), width=int(m(0.0009)))
    paste(l, blur=0.35)
    # eyebrow: tapered thick stroke
    l = layer(); d = ImageDraw.Draw(l)
    pts = []
    for k, a in enumerate(np.linspace(0, 1, 24)):
        x = s * (0.016 + a * 0.040)
        y = 1.6745 + 0.0042 * np.sin(a * np.pi * 0.95) - 0.002 * a
        w = 0.0050 * (1 - 0.55 * a)
        cx, cy = px(x, y)
        d.ellipse([cx - m(w) * 0.6, cy - m(w) * 0.5, cx + m(w) * 0.6, cy + m(w) * 0.5], fill=(59, 38, 24, 255))
    paste(l, blur=0.4)

# mouth: gentle smile
l = layer(); d = ImageDraw.Draw(l)
pts = []
for a in np.linspace(-1, 1, 30):
    x = a * 0.0125
    y = 1.5885 + 0.0032 * (a * a) - 0.0007
    pts.append(px(x, y))
d.line(pts, fill=(128, 56, 46, 255), width=int(m(0.0019)), joint="curve")
# lower lip warm hint
cx, cy = px(0, 1.5852)
d.ellipse([cx - m(0.0065), cy - m(0.0018), cx + m(0.0065), cy + m(0.0018)], fill=(214, 128, 112, 110))
paste(l, blur=0.5)

out = img.resize((N, N), Image.LANCZOS).convert("RGB")
out.save(sys.argv[1])
print("face texture", sys.argv[1])
