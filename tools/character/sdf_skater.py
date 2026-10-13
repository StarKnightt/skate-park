"""Procedural SDF modeller for the original skater character ("Sol").

Builds every clothing/body part as a signed distance field fitted to the Mixamo reference
skeleton (Bryce rest pose, metres, glTF axes: Y up, character faces +Z, left = +X),
polygonises each part with marching cubes and writes OBJ files + parts.json for Blender.

python sdf_skater.py <out_dir> <bryce_skeleton.json>
"""
import json, os, sys, time
from functools import reduce
import numpy as np
from skimage import measure

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cloth_masks as cm
import hand_rig as hr
from cloth_masks import smoothstep

OUT = sys.argv[1]
SK = json.load(open(sys.argv[2]))["bones"]
LM = cm.Landmarks(SK)
HANDS = {S: hr.Hand(SK, S) for S in "LR"}
os.makedirs(OUT, exist_ok=True)


def J(n):
    return np.array(SK["mixamorig:" + n]["head"], dtype=np.float64)


# ----------------------------------------------------------------------------- primitives
def nrm(v):
    return np.sqrt(np.einsum("ij,ij->i", v, v))


def rot(axis, deg):
    a = np.radians(deg); c, s = np.cos(a), np.sin(a)
    if axis == "x":
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == "y":
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def ellipsoid(p, c, r, R=None):
    q = p - c
    if R is not None:
        q = q @ R
    r = np.asarray(r, dtype=np.float64)
    k0 = nrm(q / r); k1 = nrm(q / (r * r))
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-12)


def round_cone(p, a, b, r1, r2):
    ba = b - a; l2 = ba @ ba; rr = r1 - r2; a2 = l2 - rr * rr; il2 = 1.0 / l2
    pa = p - a
    y = pa @ ba
    z = y - l2
    x = pa * l2 - y[:, None] * ba
    x2 = np.einsum("ij,ij->i", x, x)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
    d1 = np.sqrt(x2 + z2) * il2 - r2
    d2 = np.sqrt(x2 + y2) * il2 - r1
    return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))


def round_box(p, c, half, rad, R=None):
    q = p - c
    if R is not None:
        q = q @ R
    q = np.abs(q) - (np.asarray(half) - rad)
    return nrm(np.maximum(q, 0)) + np.minimum(q.max(1), 0) - rad


def sphere(p, c, r):
    return nrm(p - c) - r


def plane(p, point, n):
    n = np.asarray(n, dtype=np.float64); n = n / np.linalg.norm(n)
    return (p - point) @ n


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def sunion(k, *ds):
    return reduce(lambda a, b: smin(a, b, k), ds)


def union(*ds):
    return reduce(np.minimum, ds)


def scaled(p, c, s):
    """Anisotropic domain scale around c (s>1 squashes the shape along that axis)."""
    return (p - c) * np.asarray(s) + c


def nunit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


# ----------------------------------------------------------------------------- skeleton points
SIDES = {"L": ("Left", 1.0), "R": ("Right", -1.0)}
HIPS = J("Hips")


def arm_pts(S):
    n = SIDES[S][0]
    return J(n + "Arm"), J(n + "ForeArm"), J(n + "Hand")


def leg_pts(S):
    n = SIDES[S][0]
    return J(n + "UpLeg"), J(n + "Leg"), J(n + "Foot"), J(n + "ToeBase"), J(n + "Toe_End")


# ----------------------------------------------------------------------------- parts
def part_head(p):
    cran = ellipsoid(p, [0, 1.686, -0.006], [0.097, 0.107, 0.106])
    face = ellipsoid(p, [0, 1.612, 0.030], [0.079, 0.082, 0.083])
    chin = ellipsoid(p, [0, 1.553, 0.058], [0.038, 0.028, 0.034])
    d = sunion(0.035, cran, face, chin)
    cheeks = union(*[ellipsoid(p, [s * 0.047, 1.602, 0.068], [0.034, 0.030, 0.030]) for s in (1, -1)])
    d = smin(d, cheeks, 0.022)
    brow = ellipsoid(p, [0, 1.676, 0.083], [0.074, 0.017, 0.028])
    d = smin(d, brow, 0.02)
    nose = ellipsoid(p, [0, 1.628, 0.1035], [0.0105, 0.0155, 0.0135], rot("x", -18))
    d = smin(d, nose, 0.014)
    ears = union(*[ellipsoid(p, [s * 0.095, 1.640, -0.012], [0.012, 0.030, 0.021], rot("z", s * 8) @ rot("x", 12))
                   for s in (1, -1)])
    d = smin(d, ears, 0.008)
    # neck: tapers from a wide base (flaring into the trapezius) to a slimmer top under the jaw
    neck = round_cone(p, np.array([0, 1.445, -0.034]), np.array([0, 1.585, -0.012]), 0.056, 0.0405)
    d = smin(d, neck, 0.03)
    for s in (1, -1):
        trap = ellipsoid(p, [s * 0.047, 1.488, -0.042], [0.044, 0.022, 0.036])
        d = smin(d, trap, 0.022)
        scm = round_cone(p, np.array([s * 0.041, 1.578, -0.030]), np.array([s * 0.013, 1.480, 0.026]), 0.0105, 0.0090)
        d = smin(d, scm, 0.014)
    return d


# ----------------------------------------------------------------------------- cap (six panels, set back on the head)
CAP_C = np.array([0.0, 1.694, -0.010])        # crown centre
CAP_R = rot("x", -8)                           # tilted back: front raised
CAP_RAD = np.array([0.108, 0.118, 0.120])
CAP_EDGE_P = np.array([0.0, 1.722, 0.12])      # sweatband plane: 1.722 at the front, 1.651 at the back
CAP_EDGE_N = nunit([0.0, 1.0, -0.30])
CAP_FRONT = np.array([0.0, 1.719, 0.108])


def cap_local(p):
    return (p - CAP_C) @ CAP_R


def cap_edge_y(z):
    return CAP_EDGE_P[1] - CAP_EDGE_N[2] / CAP_EDGE_N[1] * (z - CAP_EDGE_P[2])


def cap_crown_solid(p):
    d = ellipsoid(cap_local(p), np.zeros(3), CAP_RAD)
    return smax(d, -plane(p, CAP_EDGE_P, CAP_EDGE_N), 0.004)


def cap_opening(p):
    """Snapback opening at the centre back (rounded arch above the edge), only behind z < -0.05."""
    yb = cap_edge_y(-0.115)
    r = 0.020
    qx = np.abs(p[:, 0]) - (0.027 - r)
    qy = p[:, 1] - (yb + 0.036 - r)
    d2 = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0) - r
    return np.maximum(d2, p[:, 2] + 0.05)


def cap_brim(p):
    q = (p - CAP_FRONT) @ rot("x", -2)
    y2 = q[:, 1] + 3.4 * q[:, 0] ** 2 + 0.9 * np.maximum(q[:, 2], 0) ** 2
    zf = q[:, 2] + 0.014
    k0 = np.sqrt((q[:, 0] / 0.098) ** 2 + (zf / 0.090) ** 2)
    k1 = np.sqrt((q[:, 0] / 0.098 ** 2) ** 2 + (zf / 0.090 ** 2) ** 2)
    ell = k0 * (k0 - 1) / np.maximum(k1, 1e-12)
    brim = np.maximum(ell, -zf)
    return smax(brim, np.abs(y2) - 0.0030, 0.002)


def part_cap(p):
    q = cap_local(p)
    crown = ellipsoid(q, np.zeros(3), CAP_RAD)
    # six panel seams (meridians every 60 deg, one at the front centre) + stitched eyelets
    seam = np.minimum.reduce([np.abs(q @ np.array([np.cos(t), 0, -np.sin(t)])) for t in np.radians([0, 60, 120])])
    crown = crown + 0.0014 * (1 - smoothstep(0.0, 0.0030, seam)) * smoothstep(-0.02, 0.01, q[:, 1])
    for az in np.radians([90, 150, 210, 270]):
        pol = np.radians(50)
        e = np.array([np.sin(az) * np.sin(pol), np.cos(pol), np.cos(az) * np.sin(pol)]) * CAP_RAD
        crown = crown + 0.0011 * (1 - smoothstep(0.0016, 0.0042, nrm(q - e)))
    crown = smax(crown, -plane(p, CAP_EDGE_P, CAP_EDGE_N), 0.004)
    d = smin(crown, cap_brim(p), 0.006)
    d = smin(d, ellipsoid(q, np.array([0, CAP_RAD[1] - 0.0012, 0]), [0.0092, 0.0050, 0.0092]), 0.003)  # top button
    d = smax(d, -cap_opening(p), 0.003)
    # snapback strap across the bottom of the opening, flush with the crown surface, with snap studs
    yb = cap_edge_y(-0.115)
    shell = np.abs(ellipsoid(q, np.zeros(3), CAP_RAD) + 0.0012) - 0.0022
    strap = np.maximum.reduce([shell, np.abs(p[:, 1] - (yb + 0.0068)) - 0.0068, np.abs(p[:, 0]) - 0.034, p[:, 2] + 0.05])
    d = smin(d, strap, 0.002)
    for x in (-0.014, 0.0, 0.014):
        zc = CAP_C[2] - CAP_RAD[2] * np.sqrt(max(0.0, 1 - ((yb + 0.0068 - CAP_C[1]) / CAP_RAD[1]) ** 2 - (x / CAP_RAD[0]) ** 2))
        d = smin(d, sphere(p, np.array([x, yb + 0.0068, zc - 0.0006]), 0.0028), 0.0015)
    return d


def part_hair(p):
    rng = np.random.default_rng(11)
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    # thin shell hugging the skull: above the ears, and behind them down to a nape hairline rising towards the ears
    skull = ellipsoid(p, [0, 1.686, -0.007], [0.1035, 0.1135, 0.1125])
    above_ears = smax(1.666 - y, z - 0.028, 0.004)
    behind = smax(1.604 + 3.6 * x ** 2 - y, z + 0.036, 0.004)
    ds = [smax(skull, np.minimum(above_ears, behind), 0.004)]

    centre = np.array([0, 1.686, -0.007])

    def lock(root, drop, out, r0, bend=0.55, flat=1.8):
        """tapered two-segment lock, flattened against the head (ribbon-like)"""
        n = nunit(root - centre)
        q = p + (flat - 1.0) * ((p - root) @ n)[:, None] * n
        mid = root + drop * bend + out * 0.3
        tip = root + drop + out
        ds.append(round_cone(q, root, mid, r0, r0 * 0.72))
        ds.append(round_cone(q, mid, tip, r0 * 0.72, 0.0022))

    for s in (1, -1):
        # sideburn in front of the ear
        lock(np.array([s * 0.094, 1.690, 0.022]), np.array([s * 0.002, -0.038, 0.004]), np.array([s * 0.003, 0, 0.002]), 0.0105)
        # irregular clumps escaping under the cap edge above and behind the ear, hugging the head, tips flicking out
        for z0 in np.linspace(0.006, -0.098, 7) + rng.uniform(-0.006, 0.006, 7):
            y0 = cap_edge_y(z0) + 0.003
            x0 = s * 0.100 * np.sqrt(max(0.15, 1 - ((z0 + 0.007) / 0.113) ** 2))
            l = 0.020 + rng.uniform(0, 0.022) + 0.010 * (-z0 / 0.1)
            lock(np.array([x0, y0, z0]), np.array([s * 0.002, -l, -0.006 + rng.uniform(-0.006, 0.004)]),
                 np.array([s * (0.004 + rng.uniform(0, 0.006)), 0.002, -0.003]), 0.0105 + rng.uniform(0, 0.003))
    # nape: clumps of uneven length hanging over the hairline, tips flicking out
    for x0 in np.linspace(-0.068, 0.068, 9) + rng.uniform(-0.005, 0.005, 9):
        z0 = -0.106 + 0.040 * (x0 / 0.070) ** 2
        root = np.array([x0, cap_edge_y(z0) + 0.002, z0])
        l = 0.026 + rng.uniform(0, 0.026) - 0.008 * abs(x0) / 0.07
        lock(root, np.array([x0 * 0.10 + rng.uniform(-0.004, 0.004), -l, 0.003]),
             np.array([x0 * 0.12, 0.002, -0.007 - rng.uniform(0, 0.008)]), 0.0115 + rng.uniform(0, 0.003), bend=0.62)
    # fringe swept to one side under the brim
    for x0, l in ((-0.040, 0.020), (-0.018, 0.026), (0.006, 0.024), (0.029, 0.017)):
        root = np.array([x0, 1.713, 0.099])
        lock(root, np.array([0.014, -l, 0.006]), np.array([0.008, 0.002, 0.004]), 0.0105, flat=2.0)
    # tufts poking out through the snapback opening
    yb = cap_edge_y(-0.115)
    for x0 in (-0.012, 0.001, 0.013):
        root = np.array([x0, yb + 0.020, -0.102])
        lock(root, np.array([x0 * 0.5, -0.008, -0.009]), np.array([x0 * 0.4, 0.003, -0.012]), 0.0090, flat=1.3)
    d = sunion(0.006, *ds)
    # never poke through the cap (except through the snapback opening) or the brim
    d = np.maximum(d, -smax(cap_crown_solid(p), -cap_opening(p), 0.002))
    return np.maximum(d, -(cap_brim(p) - 0.0012))


# ----------------------------------------------------------------------------- tee (folds sculpted in the cloth_masks zones)
def tee_folds(p):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    disp = np.zeros(len(p))
    # waist bunching: soft wavy rolls above the hem, strongest at the front and sides
    ph = 2 * np.pi * (y - 0.97) / 0.036 + 2.4 * np.sin(9 * x + 4 * z) + 1.1 * np.sin(23 * x - 11 * z) + 0.6 * np.sin(41 * x + 17 * z)
    disp += 0.0048 * cm.waist_zone(p) * (0.6 + 0.4 * np.sin(7 * x - 5 * z + 1.0)) * np.sin(ph)
    for S in "LR":
        s = SIDES[S][1]
        # armpit drape: folds radiating from the armpit onto the chest and the back
        q = p - LM.armpit(S)
        r = nrm(q)
        zone = (1 - smoothstep(0.03, 0.12, r)) * smoothstep(0.006, 0.03, r)
        disp += 0.0040 * zone * np.sin(5 * np.arctan2(q[:, 1], q[:, 2]) + 1.3 * s)
        # shoulders: shallow tension folds running from the collar towards the armpit, front and back
        v = np.array([0.737, s * 0.676])
        zs = (smoothstep(0.05, 0.08, s * x) * (1 - smoothstep(0.15, 0.19, s * x)) * smoothstep(1.32, 1.36, y)
              * (1 - smoothstep(1.44, 1.48, y)) * smoothstep(0.03, 0.07, np.abs(z + 0.02)))
        disp += 0.0024 * zs * np.sin(2 * np.pi * (x * v[0] + y * v[1]) / 0.030)
        # sleeve creases: rings with a twist, stronger underneath, faded inside the cuff
        e, dd = LM.sleeve_end(S)
        t, rl, rd = cm.axis_coords(p, e, dd)
        zone = smoothstep(0.022, 0.035, -t) * (1 - smoothstep(0.09, 0.14, -t)) * (rl < 0.1)
        under = 0.45 + 0.55 * smoothstep(-0.2, 0.6, -rd[:, 1])
        disp += 0.0030 * zone * under * np.sin(2 * np.pi * (-t) / 0.030 + 3 * rd[:, 2])
    return disp


def part_tee(p):
    chest = ellipsoid(p, [0, 1.318, -0.014], [0.176, 0.150, 0.118])
    lower = round_cone(scaled(p, np.array([0, 1.15, 0.0]), [1, 1, 1 / 0.70]),
                       np.array([0, 1.30, 0.0]), np.array([0, 0.975, 0.004]), 0.166, 0.162)
    d = smin(chest, lower, 0.06)
    for S in "LR":
        sh, el, wr = arm_pts(S)
        s = SIDES[S][1]
        trap = round_cone(p, np.array([s * 0.055, 1.452, -0.030]), np.array([s * 0.180, 1.428, -0.030]), 0.058, 0.064)
        d = smin(d, trap, 0.045)
        s_end, adir = tee_sleeve_end(S)
        sleeve = round_cone(p, sh - adir * 0.04 + np.array([0, -0.004, 0]), s_end, 0.074, 0.062)
        sleeve = np.maximum(sleeve, plane(p, s_end, adir))
        d = smin(d, sleeve, 0.03)
    # back of the neckline: fill the dip between the shoulder pieces
    d = smin(d, round_cone(p, np.array([-0.06, 1.455, -0.036]), np.array([0.06, 1.455, -0.036]), 0.056, 0.056), 0.03)
    hem = cm.TEE_HEM_Y + 0.004 * np.sin(5 * np.arctan2(p[:, 0], p[:, 2]) + 0.7)
    d = smax(d, hem - p[:, 1], 0.004)
    # crew-neck opening: inside the collar ring, above the collar plane (low at the front, high at the back)
    q = collar_local(p)
    cut = np.maximum(np.sqrt(q[:, 0] ** 2 + (q[:, 2] / 0.92) ** 2) - 0.066, -(q[:, 1] - 0.002))
    d = smax(d, -cut, 0.006)
    return d + tee_folds(p)


COLLAR_C = np.array([0.0, 1.478, -0.022])


def collar_local(p):
    return (p - COLLAR_C) @ rot("x", 16)


def tee_sleeve_end(S):
    return LM.sleeve_end(S)


def part_cream(p):
    """Collar + sleeve cuffs (cream ribbing)."""
    q = collar_local(p)
    xz = np.sqrt(q[:, 0] ** 2 + (q[:, 2] / 0.92) ** 2) - 0.0605
    collar = np.sqrt(xz ** 2 + q[:, 1] ** 2) - 0.0122
    ds = [collar]
    for S in "LR":
        e, adir = tee_sleeve_end(S)
        c = round_cone(p, e - adir * 0.024, e - adir * 0.001, 0.0655, 0.0655)
        c = smax(c, plane(p, e, adir), 0.002)
        c = smax(c, -plane(p, e - adir * 0.026, adir), 0.002)
        ds.append(c)
    return union(*ds)


def seg2d(x, z, a, b):
    """distance from 2D points to segment a-b and the position along it (0..1)"""
    ab = np.asarray(b) - np.asarray(a)
    t = np.clip(((x - a[0]) * ab[0] + (z - a[1]) * ab[1]) / (ab @ ab), 0, 1)
    return np.hypot(x - (a[0] + t * ab[0]), z - (a[1] + t * ab[1])), t


def polyline2d(x, z, pts):
    """distance to a 2D polyline and the normalised arc position of the nearest point (for fading the ends)"""
    pts = np.asarray(pts, dtype=np.float64)
    lens = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    acc = np.concatenate([[0], np.cumsum(lens)]) / lens.sum()
    best, pos = np.full(len(x), 1e9), np.zeros(len(x))
    for i in range(len(pts) - 1):
        d, t = seg2d(x, z, pts[i], pts[i + 1])
        m = d < best
        best = np.where(m, d, best)
        pos = np.where(m, acc[i] + t * (acc[i + 1] - acc[i]), pos)
    return best, pos


# palm creases in hand coordinates (x towards the knuckles from the wrist joint, z towards the thumb side)
PALM_CREASES = [
    [(0.067, -0.041), (0.071, -0.022), (0.075, -0.004), (0.080, 0.010), (0.087, 0.021)],      # distal transverse
    [(0.066, 0.039), (0.062, 0.021), (0.058, 0.003), (0.055, -0.015), (0.053, -0.025)],      # proximal transverse
    [(0.066, 0.039), (0.055, 0.031), (0.042, 0.025), (0.028, 0.020), (0.015, 0.016), (0.007, 0.012)],   # thenar
]


def palm_detail(q, H):
    """Displacement on the palm block: palmar creases on the palm side, extensor tendons on the back."""
    x, y, z = q[:, 0], q[:, 1], q[:, 2]
    disp = np.zeros(len(q))
    palm_side = smoothstep(0.003, 0.008, -y)
    for pts in PALM_CREASES:
        d, t = polyline2d(x, z, pts)
        disp -= 0.00045 * np.exp(-(d / 0.00120) ** 2) * smoothstep(0.0, 0.12, t) * (1 - smoothstep(0.85, 1.0, t)) * palm_side
    back = smoothstep(0.004, 0.009, y)
    for f in hr.FINGERS:
        k = H.local(H.joints[f][0][None, :])[0]
        a, b = (0.016, 0.32 * k[2] - 0.004), (k[0] - 0.010, k[2])
        d, t = seg2d(x, z, a, b)
        disp += 0.00024 * np.exp(-(d / 0.0024) ** 2) * smoothstep(0.05, 0.45, t) * (1 - smoothstep(0.70, 1.0, t)) * back
    return disp


def hand_sdf(p, H):
    """Palm block (pads, thenar/hypothenar, distal pad under the finger bases, base knuckles, creases, tendons)
    with the four finger chains and the thumb chain from hand_rig (tapered, knuckled, creased, padded, nailed)."""
    wr, hx, hy, hz, R, Lp = H.wr, H.hx, H.hy, H.hz, H.R, H.Lp
    palm = round_box(p, wr + hx * (Lp * 0.50) + hy * 0.001, [Lp * 0.50, 0.0110, 0.0375], 0.0105, R)
    heel = ellipsoid(p, wr + hx * 0.020 - hy * 0.004, [0.024, 0.0125, 0.030], R)
    thenar = ellipsoid(p, wr + hx * 0.035 + hz * 0.022 - hy * 0.0075, [0.029, 0.0132, 0.0180], R)
    hypo = ellipsoid(p, wr + hx * 0.044 - hz * 0.026 - hy * 0.005, [0.035, 0.0112, 0.0125], R)
    dpad = ellipsoid(p, wr + hx * (Lp - 0.002) - hy * 0.0050, [0.0120, 0.0070, 0.041], R)
    d = sunion(0.0065, palm, heel, thenar, hypo)
    d = smin(d, dpad, 0.006)
    kn = [ellipsoid(p, H.joints[f][0] + hy * 0.0040 - hx * 0.0012, np.array([0.0082, 0.0060, 0.0080]) * (hr.SIZE[f][0] / 0.0089), R)
          for f in hr.FINGERS]
    d = smin(d, union(*kn), 0.0045)
    d = d - palm_detail(H.local(p), H)
    for f in hr.FINGERS:
        ch = H.chains[f]
        df, c = ch.evaluate(p)
        d = smin(d, df - ch.features(c), 0.0048)
    th = H.chains["Thumb"]
    dt, c = th.evaluate(p)
    return smin(d, dt - th.features(c), 0.0070)


def part_hand(p, S):
    H = HANDS[S]
    lo, hi = H.bbox(0.035)
    out = nrm(np.maximum(np.maximum(lo - p, p - hi), 0)) + 0.019   # lower bound outside: the hand is >= 19 mm inside
    m = np.all((p > lo) & (p < hi), axis=1)
    if m.any():
        out[m] = hand_sdf(p[m], H)
    return out


def part_arms(p, sides="LR"):
    """T-pose arms (palms down): deltoid, biceps (front), triceps (back), a bony elbow with an inner crease,
    a forearm bulge narrowing to a flat wrist, and the sculpted hand (hand_sdf)."""
    ds = []
    F, U = np.array([0, 0, 1.0]), np.array([0, 1.0, 0])
    for S in sides:
        n, s = SIDES[S]
        sh, el, wr = arm_pts(S)
        ua, fa = nunit(el - sh), nunit(wr - el)
        upper = round_cone(p, sh - ua * 0.02, el, 0.046, 0.0300)
        delt = ellipsoid(p, sh + ua * 0.040 + U * 0.008, [0.066, 0.050, 0.050])
        biceps = ellipsoid(p, sh + ua * 0.158 + F * 0.010 - U * 0.002, [0.074, 0.0280, 0.0290])
        triceps = ellipsoid(p, sh + ua * 0.118 - F * 0.011 + U * 0.003, [0.088, 0.0300, 0.0285])
        olec = ellipsoid(p, el - F * 0.020 + U * 0.001, [0.015, 0.0130, 0.0110])
        epis = union(ellipsoid(p, el + U * 0.0155, [0.012, 0.0090, 0.0105]), ellipsoid(p, el - U * 0.0150, [0.012, 0.0090, 0.0105]))
        fore = round_cone(scaled(p, el, [1, 1.22, 1]), el, wr, 0.0300, 0.0222)
        fbulge = ellipsoid(p, el + fa * 0.068 + U * 0.002, [0.082, 0.0300, 0.0350])
        arm = sunion(0.013, upper, delt, biceps, triceps, olec, epis, fore, fbulge)
        t, rl, rd = cm.axis_coords(p, el, nunit(ua + fa))
        arm = arm + 0.0024 * np.exp(-(t / 0.0075) ** 2) * smoothstep(0.3, 0.9, rd[:, 2]) * (rl < 0.06)   # inner-elbow crease
        ds.append(smin(arm, part_hand(p, S), 0.010))
    return union(*ds)


def part_legs(p):
    ds = []
    for S in "LR":
        hip, kn, an, toe, toe_end = leg_pts(S)
        thigh = round_cone(p, hip + np.array([0, 0.03, 0]), kn, 0.076, 0.052)
        shin = round_cone(p, kn, an + np.array([0, -0.02, 0]), 0.048, 0.033)
        calf = ellipsoid(p, kn + (an - kn) * 0.28 + np.array([0, 0, -0.016]), [0.044, 0.088, 0.042])
        knee = ellipsoid(p, kn + np.array([0, 0.004, 0.018]), [0.040, 0.034, 0.030])
        ds.append(sunion(0.03, thigh, shin, calf, knee))
    return union(*ds)


def shin_radius_at(S, y):
    hip, kn, an, toe, toe_end = leg_pts(S)
    t = (kn[1] - y) / (kn[1] - an[1])
    return 0.048 + (0.033 - 0.048) * min(max(t, 0), 1), kn + (an - kn) * t


def seg_dist2(px_, py_, a, b):
    """distance from 2D points to segment a-b"""
    ab = b - a
    t = np.clip(((px_ - a[0]) * ab[0] + (py_ - a[1]) * ab[1]) / (ab @ ab), 0, 1)
    return np.hypot(px_ - (a[0] + t * ab[0]), py_ - (a[1] + t * ab[1]))


def shorts_folds(p):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    disp = np.zeros(len(p))
    cr = LM.crotch()
    q = p - cr
    front = smoothstep(0.02, 0.07, z)
    for S in "LR":
        s = SIDES[S][1]
        # front-hip whiskers fanning from the crotch towards the hip bone
        zone = (1 - smoothstep(0.02, 0.085, nrm(p - LM.front_hip(S)))) * front * (s * x > 0)
        disp += 0.0038 * zone * np.sin(8 * np.arctan2(q[:, 1], s * q[:, 0]) + 1.0)
        # above the knee: ripples around the leg (front and back), faded inside the hem cuff
        e, dd = LM.shorts_hem(S)
        t, rl, rd = cm.axis_coords(p, e, dd)
        zone = smoothstep(0.038, 0.052, -t) * (1 - smoothstep(0.085, 0.15, -t)) * (rl < 0.13) * (s * x > 0)
        az = np.arctan2(rd[:, 2], rd[:, 0] * s)
        ph = 2 * np.pi * (-t) / 0.036 + 3.0 * rd[:, 0] * s + 2.0 * rd[:, 2] + 1.7 * np.sin(5 * az + s) + 1.3 * s
        disp += 0.0042 * zone * (0.35 + 0.65 * np.abs(rd[:, 2])) * (0.65 + 0.35 * np.sin(3 * az - 1.0)) * np.sin(ph)
        # slash pocket openings on the front hips
        pk = seg_dist2(x, y, np.array([s * 0.088, 1.022]), np.array([s * 0.140, 0.930]))
        disp += 0.0013 * (1 - smoothstep(0.0, 0.0024, pk)) * smoothstep(-0.01, 0.03, z)
    # crotch: short radial creases front and back
    disp += 0.0022 * (1 - smoothstep(0.02, 0.075, nrm(q))) * np.sin(10 * np.arctan2(q[:, 2], q[:, 0]))
    # raised waistband + fly J-seam
    disp -= 0.0016 * smoothstep(1.019, 1.025, y)
    fly = (1 - smoothstep(0.0, 0.0022, np.abs(x - 0.013))) * smoothstep(0.905, 0.915, y) * (1 - smoothstep(1.012, 1.019, y))
    disp += 0.0011 * fly * front
    return disp


def part_shorts(p):
    pel = ellipsoid(p, [0, 0.975, 0.006], [0.162, 0.128, 0.118])
    legs = []
    for S in "LR":
        end, ldir = shorts_hem(S)
        leg = round_cone(p, LM.shorts_top(S), end, 0.100, 0.088)
        legs.append(np.maximum(leg, plane(p, end, ldir)))
    d = smin(pel, union(*legs), 0.05)
    d = smax(d, p[:, 1] - 1.055, 0.004)
    # back pockets (subtle raised panels)
    for s in (1, -1):
        pk = round_box(p, np.array([s * 0.072, 0.985, -0.116]), [0.042, 0.048, 0.008], 0.006, rot("y", s * 10) @ rot("x", 8))
        d = smin(d, pk, 0.004)
    return d + shorts_folds(p)


def shorts_hem(S):
    return LM.shorts_hem(S)


def part_shorts_cuff(p):
    ds = []
    for S in "LR":
        e, ldir = shorts_hem(S)
        c = round_cone(p, e - ldir * 0.036, e + ldir * 0.004, 0.0935, 0.0935)
        c = smax(c, plane(p, e + ldir * 0.004, ldir), 0.003)
        c = smax(c, -plane(p, e - ldir * 0.038, ldir), 0.003)
        ds.append(c)
    return union(*ds)


def part_socks(p):
    ds = []
    for S in "LR":
        hip, kn, an, toe, toe_end = leg_pts(S)
        r_top, c_top = shin_radius_at(S, 0.305)
        r_bot, c_bot = shin_radius_at(S, 0.10)
        d = round_cone(p, c_bot, c_top, r_bot + 0.006, r_top + 0.0052)
        d = smax(d, plane(p, c_top, nunit(c_top - c_bot)), 0.003)
        ds.append(d)
    return union(*ds)


def part_stripes(p):
    ds = []
    for S in "LR":
        r, c = shin_radius_at(S, 0.272)
        r2, c2 = shin_radius_at(S, 0.258)
        ax = nunit(c - c2)
        d = round_cone(p, c2, c, r2 + 0.0072, r + 0.0068)
        d = smax(d, plane(p, c, ax), 0.002)
        d = smax(d, -plane(p, c2, ax), 0.002)
        ds.append(d)
    return union(*ds)


def shoe_frame(S):
    hip, kn, an, toe, toe_end = leg_pts(S)
    F = toe_end - an; F[1] = 0; F = nunit(F)
    W = np.cross(np.array([0, 1.0, 0]), F)
    O = np.array([an[0], 0.0, an[2]])
    return O, F, W


def shoe_local(p, S):
    O, F, W = shoe_frame(S)
    q = p - O
    return np.stack([q @ F, q[:, 1], q @ W], 1)  # (u forward, v up, w lateral)


def footprint(l):
    flat = np.stack([l[:, 0], np.zeros(len(l)), l[:, 2]], 1)
    return round_cone(flat, np.array([-0.034, 0, 0]), np.array([0.168, 0, 0]), 0.046, 0.057)


def shoe_upper_local(l):
    heel = ellipsoid(l, [-0.028, 0.076, 0], [0.056, 0.072, 0.047])
    mid = ellipsoid(l, [0.060, 0.062, 0], [0.102, 0.056, 0.053])
    toe = ellipsoid(l, [0.158, 0.043, 0], [0.076, 0.039, 0.053])
    d = sunion(0.03, heel, mid, toe)
    d = smax(d, 0.018 - l[:, 1], 0.004)
    # collar opening (only behind u=0.06)
    pl = (l[:, 0] + 0.085) * 0.305 + (l[:, 1] - 0.142) * 0.952
    d = np.maximum(d, np.minimum(pl, 0.058 - l[:, 0]))
    tongue = round_box(l, np.array([0.050, 0.118, 0]), [0.030, 0.010, 0.030], 0.008, rot("z", 32))
    return smin(d, tongue, 0.008)


def part_shoes(p):
    return union(*[shoe_upper_local(shoe_local(p, S)) for S in "LR"])


def part_soles(p):
    ds = []
    for S in "LR":
        l = shoe_local(p, S)
        fp = footprint(l)
        d = smax(fp, np.abs(l[:, 1] - 0.0155) - 0.0155, 0.006)
        wrap = ellipsoid(l, [0.183, 0.030, 0], [0.047, 0.030, 0.056])
        wrap = np.maximum(wrap, l[:, 1] - 0.052)
        heelcup = ellipsoid(l, [-0.040, 0.032, 0], [0.050, 0.030, 0.048])
        heelcup = np.maximum(heelcup, l[:, 1] - 0.046)
        ds.append(sunion(0.01, d, wrap, heelcup))
    return union(*ds)


def upper_surface_v(u):
    vs = np.linspace(0.16, 0.0, 400)
    l = np.stack([np.full_like(vs, u), vs, np.zeros_like(vs)], 1)
    d = shoe_upper_local(l)
    i = np.argmax(d < 0)
    return vs[i]


LACE_V = [(u, upper_surface_v(u)) for u in (0.040, 0.064, 0.088, 0.112)]


def part_laces(p):
    ds = []
    for S in "LR":
        l = shoe_local(p, S)
        for k, (u, v) in enumerate(LACE_V):
            u2 = u + 0.01
            v2 = upper_surface_v(u2)
            ang = np.degrees(np.arctan2(v2 - v, 0.01))
            ds.append(round_box(l, np.array([u, v + 0.0015, 0]), [0.0065, 0.0042, 0.031], 0.0035, rot("z", ang)))
    return union(*ds)


# ----------------------------------------------------------------------------- meshing
def bbox_pts(*pts, pad=0.0):
    a = np.array(pts)
    return a.min(0) - pad, a.max(0) + pad


def eval_grid(fn, xs, ys, zs):
    vol = np.empty((len(xs), len(ys), len(zs)), np.float32)
    Y, Z = np.meshgrid(ys, zs, indexing="ij")
    Yr, Zr = Y.ravel(), Z.ravel()
    step = max(1, int(400000 // Yr.size))
    for i in range(0, len(xs), step):
        xi = xs[i:i + step]
        P = np.stack([np.repeat(xi, Yr.size), np.tile(Yr, len(xi)), np.tile(Zr, len(xi))], 1)
        vol[i:i + step] = fn(P).reshape(len(xi), len(ys), len(zs))
    return vol


def upsample(vol, f):
    """separable linear upsampling of a grid by an integer factor (corner aligned)"""
    for ax in range(3):
        v = np.moveaxis(vol, ax, 0)
        n = v.shape[0]
        out = np.empty(((n - 1) * f + 1,) + v.shape[1:], np.float32)
        for k in range(f):
            out[k:(n - 1) * f:f] = v[:-1] * (1 - k / f) + v[1:] * (k / f)
        out[-1] = v[-1]
        vol = np.moveaxis(out, 0, ax)
    return np.ascontiguousarray(vol)


def hand_budget(S, hand_tris):
    """Post-process for the fine-voxel arms: relax once (like the Blender smooth pass), then quadric-decimate the
    whole part until the hand holds ~hand_tris; build_skater.py then thins only the arm above the wrist."""
    import trimesh
    import fast_simplification as fs

    def post(verts, faces):
        m = trimesh.Trimesh(verts, faces, process=False)
        trimesh.smoothing.filter_laplacian(m, lamb=0.5, iterations=1, volume_constraint=False)
        V, F = np.asarray(m.vertices, np.float64), np.asarray(m.faces, np.int32)
        tot, best = int(hand_tris / 0.40), None
        for _ in range(8):   # the hand share is not monotonic in the total: keep the closest result
            V2, F2 = fs.simplify(V, F, target_count=tot, agg=3)
            hand = int(HANDS[S].in_hand(V2[F2].mean(1)).sum())
            if best is None or abs(hand - hand_tris) < abs(best[2] - hand_tris):
                best = (V2, F2, hand)
            if abs(hand - hand_tris) <= 0.03 * hand_tris:
                break
            tot = int(tot * (1 + 0.8 * (hand_tris / max(hand, 1) - 1)))
        V2, F2, hand = best
        print("  %s hand budget: %d tris total, %d in the hand" % (S, len(F2), hand), flush=True)
        return V2, F2
    return post


def mesh_part(name, fn, bmin, bmax, h, nb=0, post=None):
    """Marching cubes of one part. nb > 0: narrow band - a grid nb times coarser finds the surface, and the
    exact field is only evaluated within 1.6 coarse voxels of it (fine voxels for small detail, e.g. the hands).
    post(verts, faces) -> (verts, faces) runs before the OBJ is written."""
    t0 = time.time()
    bmin = np.asarray(bmin, float) - 3 * h
    bmax = np.asarray(bmax, float) + 3 * h
    mask = None
    if nb:
        hc = h * nb
        nc = np.ceil((bmax - bmin) / hc).astype(int) + 1
        vol = upsample(eval_grid(fn, *[bmin[i] + np.arange(nc[i]) * hc for i in range(3)]), nb)
        n = np.array(vol.shape)
        ax = [bmin[i] + np.arange(n[i]) * h for i in range(3)]
        mask = np.abs(vol) < 1.6 * hc
        idx = np.nonzero(mask)
        for a in range(0, len(idx[0]), 400000):
            ii = tuple(k[a:a + 400000] for k in idx)
            vol[ii] = fn(np.stack([ax[0][ii[0]], ax[1][ii[1]], ax[2][ii[2]]], 1))
        evals = len(idx[0])
    else:
        n = np.ceil((bmax - bmin) / h).astype(int) + 1
        vol = eval_grid(fn, *[bmin[i] + np.arange(n[i]) * h for i in range(3)])
        evals = vol.size
    # force a closed border
    vol[0, :, :] = vol[-1, :, :] = 1; vol[:, 0, :] = vol[:, -1, :] = 1; vol[:, :, 0] = vol[:, :, -1] = 1
    verts, faces, _, _ = measure.marching_cubes(vol, level=0.0, spacing=(h, h, h), mask=mask)
    verts += bmin
    mc_tris = len(faces)
    if post:
        verts, faces = post(verts, faces)
    v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    vol6 = np.einsum("ij,ij->i", v0, np.cross(v1, v2)).sum()
    if vol6 < 0:
        faces = faces[:, [0, 2, 1]]
    path = os.path.join(OUT, name + ".obj")
    with open(path, "w") as f:
        f.write("o %s\n" % name)
        np.savetxt(f, verts, fmt="v %.5f %.5f %.5f")
        np.savetxt(f, faces + 1, fmt="f %d %d %d")
    print("%-12s grid %s  evals %9d  mc tris %7d  verts %7d  tris %7d  %.1fs" % (
        name, tuple(int(k) for k in n), evals, mc_tris, len(verts), len(faces), time.time() - t0), flush=True)
    return len(faces)


# colours are sRGB hex; material "vc" uses vertex colour, "face" uses the painted face texture
# options: nb = narrow-band factor (mesh_part); hand_tris = separate decimation budget for the hand (build_skater.py),
# target tris then counts the arm up to the wrist only
ARM_OPT = {"nb": 3, "hand_tris": 9000}
PARTS = [
    # name, fn, bbox, voxel, colour, material, target tris[, options]
    ("head", part_head, ([-0.13, 1.40, -0.14], [0.13, 1.83, 0.15]), 0.0022, "#e9b48f", "face", 7500),
    ("hair", part_hair, ([-0.135, 1.56, -0.15], [0.135, 1.75, 0.125]), 0.0018, "#4a2e1c", "vc", 5200),
    ("cap", part_cap, ([-0.125, 1.63, -0.14], [0.125, 1.83, 0.21]), 0.0016, "#e5b03b", "vc", 6500),
    ("tee", part_tee, ([-0.40, 0.94, -0.16], [0.40, 1.53, 0.14]), 0.0030, "#2f8f86", "vc", 9000),
    ("cream", part_cream, ([-0.40, 1.36, -0.12], [0.40, 1.50, 0.08]), 0.0025, "#f1e6cc", "vc", 1800),
    ("armL", lambda p: part_arms(p, "L"), ([0.13, 1.30, -0.11], [0.95, 1.50, 0.10]), 0.0008, "#e9b48f", "vc", 3300, ARM_OPT),
    ("armR", lambda p: part_arms(p, "R"), ([-0.95, 1.30, -0.11], [-0.13, 1.50, 0.10]), 0.0008, "#e9b48f", "vc", 3300, ARM_OPT),
    ("legs", part_legs, ([-0.24, 0.05, -0.12], [0.24, 0.98, 0.11]), 0.0045, "#e9b48f", "vc", 2400),
    ("shorts", part_shorts, ([-0.27, 0.48, -0.15], [0.27, 1.07, 0.15]), 0.0030, "#d2bd8e", "vc", 7500),
    ("shortscuff", part_shorts_cuff, ([-0.26, 0.50, -0.12], [0.26, 0.66, 0.12]), 0.0032, "#c4ad7c", "vc", 1200),
    ("socks", part_socks, ([-0.22, 0.06, -0.11], [0.22, 0.33, 0.07]), 0.0032, "#f6f3ec", "vc", 1400),
    ("stripes", part_stripes, ([-0.22, 0.24, -0.10], [0.22, 0.29, 0.06]), 0.0022, "#d2463a", "vc", 600),
    ("shoes", part_shoes, ([-0.27, 0.0, -0.16], [0.27, 0.17, 0.27]), 0.0030, "#2d4a86", "vc", 3800),
    ("soles", part_soles, ([-0.27, -0.005, -0.16], [0.27, 0.07, 0.28]), 0.0030, "#f0e6cf", "vc", 2400),
    ("laces", part_laces, ([-0.25, 0.05, -0.06], [0.25, 0.16, 0.20]), 0.0016, "#fbfaf5", "vc", 1200),
]

if __name__ == "__main__":
    only = set(sys.argv[3:])
    meta_path = os.path.join(OUT, "parts.json")
    old = {m["name"]: m for m in json.load(open(meta_path))} if os.path.exists(meta_path) else {}
    meta = []
    for name, fn, (bmin, bmax), h, col, mat, target, *opt in PARTS:
        opt = opt[0] if opt else {}
        if only and name not in only:
            tris = old.get(name, {}).get("tris", 0)
        else:
            post = hand_budget(name[-1], opt["hand_tris"]) if opt.get("hand_tris") else None
            tris = mesh_part(name, fn, bmin, bmax, h, opt.get("nb", 0), post)
        m = {"name": name, "color": col, "material": mat, "target_tris": target, "tris": int(tris)}
        if opt.get("hand_tris"):
            m["hand_tris"] = opt["hand_tris"]
        meta.append(m)
    json.dump(meta, open(meta_path, "w"), indent=1)
    print("done")
