"""Quick lock-free preview of the SDF parts (painter's algorithm, flat toon-ish shading, orthographic).
python preview_parts.py <parts_dir> <out.png> [view ...]
views: full_front full_34 full_back head_front head_34 head_side head_back head_top arm hand torso_34 torso_back shorts_34
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

VIEWS = {  # name: (yaw deg (0 = looking at the front), pitch deg, centre xyz, half height m, image w, h)
    "full_front": (0, 0, (0, 0.90, 0), 0.95, 520, 1000),
    "full_34": (35, 5, (0, 0.90, 0), 0.95, 520, 1000),
    "full_back": (180, 8, (0, 0.90, 0), 0.95, 520, 1000),
    "head_front": (0, 4, (0, 1.665, 0.02), 0.15, 640, 640),
    "head_34": (38, 6, (0, 1.665, 0.02), 0.15, 640, 640),
    "head_side": (90, 0, (0, 1.665, 0.0), 0.15, 640, 640),
    "head_back": (160, 14, (0, 1.640, 0.0), 0.15, 640, 640),
    "head_top": (25, 50, (0, 1.70, 0.02), 0.15, 640, 640),
    "neck": (25, 0, (0, 1.52, 0.0), 0.12, 640, 640),
    "arm": (8, 12, (0.50, 1.42, -0.02), 0.13, 900, 360),
    "arm_back": (175, 12, (0.50, 1.42, -0.02), 0.13, 900, 360),
    "hand": (12, 35, (0.80, 1.405, -0.01), 0.07, 640, 480),
    "hand_under": (12, -40, (0.80, 1.405, -0.01), 0.07, 640, 480),
    "torso_34": (30, 6, (0, 1.22, 0), 0.32, 700, 640),
    "torso_back": (200, 8, (0, 1.22, 0), 0.32, 700, 640),
    "shorts_34": (25, 4, (0, 0.80, 0.0), 0.30, 640, 640),
    "shorts_back": (200, 4, (0, 0.80, 0.0), 0.30, 640, 640),
}


def load_obj(path):
    v, f = [], []
    with open(path) as fh:
        for line in fh:
            if line.startswith("v "):
                v.append(line[2:].split())
            elif line.startswith("f "):
                f.append([int(x.split("/")[0]) - 1 for x in line[2:].split()])
    return np.array(v, float), np.array(f, int)


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)


def render(parts_dir, view, out):
    yaw, pitch, c, hh, w, h = VIEWS[view]
    meta = json.load(open(os.path.join(parts_dir, "parts.json")))
    a, b = np.radians(yaw), np.radians(pitch)
    # camera basis: forward looks at -Z of the character when yaw = 0 (camera in front, character faces +Z)
    fwd = np.array([-np.sin(a) * np.cos(b), -np.sin(b), -np.cos(a) * np.cos(b)])
    right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    light = np.array([0.45, 0.75, 0.55]); light /= np.linalg.norm(light)
    ss = 2
    W, H = w * ss, h * ss
    scale = H / (2 * hh)
    polys, cols, depth = [], [], []
    for p in meta:
        path = os.path.join(parts_dir, p["name"] + ".obj")
        if not os.path.exists(path):
            continue
        V, F = load_obj(path)
        q = V - np.asarray(c)
        X, Y, Z = q @ right, q @ up, q @ fwd
        tri = F
        x2 = W / 2 + X[tri] * scale
        y2 = H / 2 - Y[tri] * scale
        keep = (x2.max(1) > 0) & (x2.min(1) < W) & (y2.max(1) > 0) & (y2.min(1) < H)
        n = np.cross(V[tri[:, 1]] - V[tri[:, 0]], V[tri[:, 2]] - V[tri[:, 0]])
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        facing = (n @ fwd) < 0
        keep &= facing
        diff = np.clip(n @ light, 0, 1)
        band = 0.55 + 0.45 * np.clip((diff - 0.15) / 0.5, 0, 1)
        rim = np.clip(1 - np.abs(n @ fwd), 0, 1) ** 4 * 0.25
        shade = np.clip(band * (0.75 + 0.35 * diff) + rim, 0, 1.3)
        col = hex_rgb(p["color"])
        cc = np.clip(col[None, :] * shade[:, None], 0, 255).astype(int)
        for i in np.nonzero(keep)[0]:
            polys.append(list(zip(x2[i], y2[i])))
            cols.append(tuple(cc[i]))
        depth.extend(Z[tri[keep]].mean(1))
    order = np.argsort(-np.asarray(depth))
    img = Image.new("RGB", (W, H), (232, 222, 206))
    d = ImageDraw.Draw(img)
    for i in order:
        d.polygon(polys[i], fill=cols[i])
    return img.resize((w, h), Image.LANCZOS)


if __name__ == "__main__":
    parts_dir, out = sys.argv[1], sys.argv[2]
    views = sys.argv[3:] or ["head_34", "head_back", "arm", "torso_34"]
    imgs = [render(parts_dir, v, out) for v in views]
    if len(imgs) == 1:
        imgs[0].save(out)
    else:
        hmax = max(i.size[1] for i in imgs)
        tot = sum(i.size[0] for i in imgs)
        sheet = Image.new("RGB", (tot, hmax), (40, 40, 40))
        x = 0
        for i in imgs:
            sheet.paste(i, (x, 0)); x += i.size[0]
        sheet.save(out)
    print("preview", out)
