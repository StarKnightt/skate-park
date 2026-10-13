"""Prepare web textures from the generated art + CC0 sources.
python prep_textures.py <generated_assets_dir> <project_dir>
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

GEN, PROJ = sys.argv[1], sys.argv[2]
OUT = os.path.join(PROJ, "public", "textures")
SRC = os.path.join(OUT, "src")
os.makedirs(OUT, exist_ok=True)


def save(img, name, q=82):
    p = os.path.join(OUT, name)
    img.save(p, "WEBP", quality=q, method=6)
    print(name, img.size, os.path.getsize(p) // 1024, "KB")


def crop_aspect(img, aspect, cy=0.5):
    w, h = img.size
    th = int(round(w / aspect))
    if th <= h:
        top = int((h - th) * cy)
        return img.crop((0, top, w, top + th))
    tw = int(round(h * aspect))
    left = (w - tw) // 2
    return img.crop((left, 0, left + tw, h))


# murals (crops chosen to keep the main subject)
murals = {
    "mural_sunwaves": (2.67, 0.62),
    "mural_koi": (3.05, 0.45),
    "mural_patchwork": (3.4, 0.55),
}
for name, (aspect, cy) in murals.items():
    im = Image.open(os.path.join(GEN, name + ".jpg")).convert("RGB")
    im = crop_aspect(im, aspect, cy)
    im = im.resize((1536, int(1536 / aspect)), Image.LANCZOS)
    save(im, name + ".webp", 80)

# deck graphic: centre strip matching the deck outline (0.21 x 0.81 m)
im = Image.open(os.path.join(GEN, "deck_graphic.jpg")).convert("RGB")
w, h = im.size
sw = int(h * 0.21 / 0.81)
im = im.crop(((w - sw) // 2, 0, (w - sw) // 2 + sw, h)).resize((256, 1024), Image.LANCZOS)
save(im, "deck_graphic.webp", 85)

# clouds: chroma-key the green screen, despill, split into an atlas description
im = np.asarray(Image.open(os.path.join(GEN, "clouds_sheet.jpg")).convert("RGB")).astype(np.float32) / 255
r, g, b = im[..., 0], im[..., 1], im[..., 2]
spill = g - np.maximum(r, b)
alpha = 1 - np.clip((spill - 0.06) / 0.30, 0, 1)
alpha = ndimage.gaussian_filter(alpha, 0.7)
g2 = np.minimum(g, np.maximum(r, b) * 1.02)
rgb = np.stack([r, g2, b], -1)
lab, n = ndimage.label(alpha > 0.15)
rects = []
H, W = alpha.shape
for i in range(1, n + 1):
    ys, xs = np.where(lab == i)
    if len(xs) < 2000:
        continue
    x0, x1, y0, y1 = xs.min() - 6, xs.max() + 6, ys.min() - 6, ys.max() + 6
    rects.append({"u0": max(0, x0) / W, "u1": min(W, x1) / W, "v0": 1 - min(H, y1) / H, "v1": 1 - max(0, y0) / H,
                  "aspect": (x1 - x0) / (y1 - y0)})
rgba = np.concatenate([rgb, alpha[..., None]], -1)
# bleed colour into transparent pixels to avoid dark fringes when mip-mapping
mask = alpha > 0.3
idx = ndimage.distance_transform_edt(~mask, return_distances=False, return_indices=True)
rgba[..., :3] = rgb[idx[0], idx[1]]
cl = Image.fromarray((rgba * 255).astype(np.uint8), "RGBA").resize((1024, 576), Image.LANCZOS)
cl.save(os.path.join(OUT, "clouds.webp"), "WEBP", quality=88, method=6)
json.dump(rects, open(os.path.join(OUT, "clouds.json"), "w"), indent=1)
print("clouds", len(rects))

# concrete detail: neutral grey detail map (mean 0.5), tileable
c = Image.open(os.path.join(SRC, "concrete_color.jpg")).convert("L")
a = np.asarray(c).astype(np.float32)
a = (a - a.mean()) / (a.std() + 1e-6) * 0.18 + 0.5
a = np.clip(a, 0, 1)
save(Image.fromarray((a * 255).astype(np.uint8)).convert("RGB"), "concrete_detail.webp", 78)

# wood planks
wd = Image.open(os.path.join(SRC, "wood_color.jpg")).convert("RGB")
save(wd.resize((1024, 1024), Image.LANCZOS), "wood_planks.webp", 80)
