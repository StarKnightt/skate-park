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

OUT = sys.argv[1]
SK = json.load(open(sys.argv[2]))["bones"]
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
    neck = round_cone(p, np.array([0, 1.43, -0.032]), np.array([0, 1.585, -0.008]), 0.049, 0.046)
    d = smin(d, neck, 0.03)
    return d


def part_hair(p):
    ds = []
    ds.append(ellipsoid(p, [0, 1.648, -0.078], [0.083, 0.052, 0.042]))
    for s in (1, -1):
        ds.append(ellipsoid(p, [s * 0.090, 1.680, -0.030], [0.022, 0.032, 0.058]))
        # sideburn tufts in front of the ears
        ds.append(round_cone(p, np.array([s * 0.093, 1.700, 0.018]), np.array([s * 0.099, 1.640, 0.030]), 0.017, 0.005))
        # messy tufts at the back poking out under the cap
        ds.append(round_cone(p, np.array([s * 0.055, 1.670, -0.098]), np.array([s * 0.072, 1.610, -0.104]), 0.022, 0.006))
        ds.append(round_cone(p, np.array([s * 0.082, 1.680, -0.070]), np.array([s * 0.104, 1.630, -0.078]), 0.018, 0.005))
        ds.append(round_cone(p, np.array([s * 0.020, 1.660, -0.105]), np.array([s * 0.024, 1.598, -0.112]), 0.022, 0.006))
        ds.append(round_cone(p, np.array([s * 0.095, 1.700, -0.010]), np.array([s * 0.112, 1.660, -0.020]), 0.016, 0.004))
    # bangs under the brim
    for x, l in ((-0.052, 0.030), (-0.022, 0.038), (0.012, 0.034), (0.043, 0.028)):
        ds.append(round_cone(p, np.array([x, 1.699, 0.083]), np.array([x + 0.010, 1.699 - l, 0.104]), 0.014, 0.0035))
    d = sunion(0.012, *ds)
    # never poke through the cap crown
    crown = ellipsoid(p, [0, 1.690, -0.004], [0.112, 0.121, 0.124])
    above = -plane(p, np.array([0, 1.698, 0.12]), [0, 0.979, -0.204])
    return np.maximum(d, -np.maximum(crown, above))


CAP_FRONT = np.array([0, 1.706, 0.112])


def part_cap(p):
    crown = ellipsoid(p, [0, 1.690, -0.004], [0.108, 0.117, 0.119])
    cut = plane(p, np.array([0, 1.704, 0.12]), [0, 0.979, -0.204])
    crown = smax(crown, -cut, 0.004)
    # brim: curved plate, tilted slightly down, sides bent down
    q = p - CAP_FRONT
    q = q @ rot("x", 8)
    y2 = q[:, 1] + 1.9 * q[:, 0] ** 2
    zf = q[:, 2] + 0.012
    k0 = np.sqrt((q[:, 0] / 0.099) ** 2 + (zf / 0.090) ** 2)
    k1 = np.sqrt((q[:, 0] / 0.099 ** 2) ** 2 + (zf / 0.090 ** 2) ** 2)
    ell = k0 * (k0 - 1) / np.maximum(k1, 1e-12)
    brim = np.maximum(ell, -zf + 0.0)
    brim = smax(brim, np.abs(y2) - 0.0038, 0.002)
    d = smin(crown, brim, 0.006)
    button = sphere(p, np.array([0, 1.806, -0.004]), 0.0115)
    return smin(d, button, 0.004)


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
        adir = nunit(el - sh)
        s_end = sh + adir * 0.135 + np.array([0, -0.006, 0])
        sleeve = round_cone(p, sh - adir * 0.04 + np.array([0, -0.004, 0]), s_end, 0.074, 0.062)
        sleeve = np.maximum(sleeve, plane(p, s_end, adir))
        d = smin(d, sleeve, 0.03)
    d = smax(d, 0.968 - p[:, 1], 0.004)  # hem
    # neck opening
    d = smax(d, -ellipsoid(p, [0, 1.478, -0.020], [0.058, 0.030, 0.052]), 0.01)
    return d


def tee_sleeve_end(S):
    sh, el, wr = arm_pts(S)
    adir = nunit(el - sh)
    return sh + adir * 0.135 + np.array([0, -0.006, 0]), adir


def part_cream(p):
    """Collar + sleeve cuffs (cream ribbing)."""
    q = (p - np.array([0, 1.468, -0.016])) @ rot("x", -14)
    xz = np.sqrt(q[:, 0] ** 2 / 1.0 + (q[:, 2] / 0.92) ** 2) - 0.062
    collar = np.sqrt(xz ** 2 + q[:, 1] ** 2) - 0.0125
    ds = [collar]
    for S in "LR":
        e, adir = tee_sleeve_end(S)
        c = round_cone(p, e - adir * 0.024, e - adir * 0.001, 0.0655, 0.0655)
        c = smax(c, plane(p, e, adir), 0.002)
        c = smax(c, -plane(p, e - adir * 0.026, adir), 0.002)
        ds.append(c)
    return union(*ds)


def part_arms(p, sides="LR"):
    ds = []
    for S in sides:
        n, s = SIDES[S]
        sh, el, wr = arm_pts(S)
        upper = round_cone(p, sh + np.array([-s * 0.03, 0, 0]), el, 0.047, 0.037)
        fore = round_cone(scaled(p, el, [1, 1.22, 1]), el, wr, 0.038, 0.029)
        fbulge = ellipsoid(p, el + (wr - el) * 0.28, [0.07, 0.034, 0.038])
        arm = sunion(0.016, upper, fore, fbulge)
        # hand
        knuck = (J(n + "HandIndex1") + J(n + "HandMiddle1") + J(n + "HandRing1") + J(n + "HandPinky1")) / 4
        hdir = nunit(knuck - wr)
        hc = wr + (knuck - wr) * 0.52 + np.array([0, -0.002, 0])
        # local frame: x=hdir, y=up-ish, z=across
        yax = nunit(np.cross(np.array([0, 0, 1.0]), hdir)) * s
        zax = np.cross(hdir, yax)
        R = np.stack([hdir, yax, zax], 1)
        palm = round_box(p, hc, [np.linalg.norm(knuck - wr) * 0.56, 0.0135, 0.041], 0.012, R)
        fingers = []
        for f, r0 in (("Index", 0.0092), ("Middle", 0.0096), ("Ring", 0.0090), ("Pinky", 0.0078)):
            pts = [J(n + "Hand" + f + str(i)) for i in range(1, 5)]
            for i in range(3):
                fingers.append(round_cone(p, pts[i], pts[i + 1], r0 * (1 - 0.07 * i), r0 * (1 - 0.07 * (i + 1))))
        tp = [J(n + "HandThumb" + str(i)) for i in range(1, 5)]
        for i in range(3):
            fingers.append(round_cone(p, tp[i], tp[i + 1], 0.0125 - 0.0012 * i, 0.0113 - 0.0012 * i))
        thenar = ellipsoid(p, (tp[0] + tp[1]) / 2 + np.array([0, -0.004, 0]), [0.022, 0.014, 0.018])
        hand = sunion(0.007, palm, thenar, *fingers)
        ds.append(smin(arm, hand, 0.012))
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


def part_shorts(p):
    pel = ellipsoid(p, [0, 0.975, 0.006], [0.162, 0.128, 0.118])
    legs = []
    for S in "LR":
        s = SIDES[S][1]
        hip, kn, an, toe, toe_end = leg_pts(S)
        top = np.array([s * 0.092, 0.94, 0.010])
        end = hip + (kn - hip) * 0.79 + np.array([s * 0.004, 0, 0])
        ldir = nunit(end - top)
        leg = round_cone(p, top, end, 0.100, 0.088)
        legs.append(np.maximum(leg, plane(p, end, ldir)))
    d = smin(pel, union(*legs), 0.05)
    d = smax(d, p[:, 1] - 1.055, 0.004)
    # back pockets (subtle raised panels)
    for s in (1, -1):
        pk = round_box(p, np.array([s * 0.072, 0.985, -0.116]), [0.042, 0.048, 0.008], 0.006, rot("y", s * 10) @ rot("x", 8))
        d = smin(d, pk, 0.004)
    return d


def shorts_hem(S):
    s = SIDES[S][1]
    hip, kn, an, toe, toe_end = leg_pts(S)
    top = np.array([s * 0.092, 0.94, 0.010])
    end = hip + (kn - hip) * 0.79 + np.array([s * 0.004, 0, 0])
    return end, nunit(end - top)


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


def mesh_part(name, fn, bmin, bmax, h):
    t0 = time.time()
    bmin = np.asarray(bmin, float) - 3 * h
    bmax = np.asarray(bmax, float) + 3 * h
    n = np.ceil((bmax - bmin) / h).astype(int) + 1
    xs = bmin[0] + np.arange(n[0]) * h
    ys = bmin[1] + np.arange(n[1]) * h
    zs = bmin[2] + np.arange(n[2]) * h
    vol = np.empty(n, np.float32)
    Y, Z = np.meshgrid(ys, zs, indexing="ij")
    Yr, Zr = Y.ravel(), Z.ravel()
    step = max(1, int(400000 // Yr.size))
    for i in range(0, n[0], step):
        xi = xs[i:i + step]
        P = np.stack([np.repeat(xi, Yr.size), np.tile(Yr, len(xi)), np.tile(Zr, len(xi))], 1)
        vol[i:i + step] = fn(P).reshape(len(xi), n[1], n[2])
    # force a closed border
    vol[0, :, :] = vol[-1, :, :] = 1; vol[:, 0, :] = vol[:, -1, :] = 1; vol[:, :, 0] = vol[:, :, -1] = 1
    verts, faces, _, _ = measure.marching_cubes(vol, level=0.0, spacing=(h, h, h))
    verts += bmin
    v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    vol6 = np.einsum("ij,ij->i", v0, np.cross(v1, v2)).sum()
    if vol6 < 0:
        faces = faces[:, [0, 2, 1]]
    path = os.path.join(OUT, name + ".obj")
    with open(path, "w") as f:
        f.write("o %s\n" % name)
        np.savetxt(f, verts, fmt="v %.5f %.5f %.5f")
        np.savetxt(f, faces + 1, fmt="f %d %d %d")
    print("%-12s grid %s  verts %7d  tris %7d  %.1fs" % (name, tuple(n), len(verts), len(faces), time.time() - t0), flush=True)
    return len(faces)


# colours are sRGB hex; material "vc" uses vertex colour, "face" uses the painted face texture
PARTS = [
    # name, fn, bbox, voxel, colour, material, target tris
    ("head", part_head, ([-0.13, 1.40, -0.14], [0.13, 1.83, 0.15]), 0.0022, "#e9b48f", "face", 7000),
    ("hair", part_hair, ([-0.14, 1.55, -0.14], [0.14, 1.75, 0.13]), 0.0022, "#3b2618", "vc", 2600),
    ("cap", part_cap, ([-0.13, 1.62, -0.14], [0.13, 1.83, 0.22]), 0.0022, "#e5b03b", "vc", 3200),
    ("tee", part_tee, ([-0.40, 0.94, -0.16], [0.40, 1.53, 0.14]), 0.0042, "#2f8f86", "vc", 5200),
    ("cream", part_cream, ([-0.40, 1.36, -0.12], [0.40, 1.50, 0.08]), 0.0025, "#f1e6cc", "vc", 1800),
    ("armL", lambda p: part_arms(p, "L"), ([0.13, 1.30, -0.11], [0.95, 1.50, 0.10]), 0.0024, "#e9b48f", "vc", 3500),
    ("armR", lambda p: part_arms(p, "R"), ([-0.95, 1.30, -0.11], [-0.13, 1.50, 0.10]), 0.0024, "#e9b48f", "vc", 3500),
    ("legs", part_legs, ([-0.24, 0.05, -0.12], [0.24, 0.98, 0.11]), 0.0045, "#e9b48f", "vc", 2400),
    ("shorts", part_shorts, ([-0.27, 0.48, -0.15], [0.27, 1.07, 0.15]), 0.0042, "#d2bd8e", "vc", 3600),
    ("shortscuff", part_shorts_cuff, ([-0.26, 0.50, -0.12], [0.26, 0.66, 0.12]), 0.0032, "#c4ad7c", "vc", 1200),
    ("socks", part_socks, ([-0.22, 0.06, -0.11], [0.22, 0.33, 0.07]), 0.0032, "#f6f3ec", "vc", 1400),
    ("stripes", part_stripes, ([-0.22, 0.24, -0.10], [0.22, 0.29, 0.06]), 0.0022, "#d2463a", "vc", 600),
    ("shoes", part_shoes, ([-0.27, 0.0, -0.16], [0.27, 0.17, 0.27]), 0.0030, "#2d4a86", "vc", 3800),
    ("soles", part_soles, ([-0.27, -0.005, -0.16], [0.27, 0.07, 0.28]), 0.0030, "#f0e6cf", "vc", 2400),
    ("laces", part_laces, ([-0.25, 0.05, -0.06], [0.25, 0.16, 0.20]), 0.0016, "#fbfaf5", "vc", 1200),
]

if __name__ == "__main__":
    only = set(sys.argv[3:])
    meta = []
    for name, fn, (bmin, bmax), h, col, mat, target in PARTS:
        if only and name not in only:
            continue
        tris = mesh_part(name, fn, bmin, bmax, h)
        meta.append({"name": name, "color": col, "material": mat, "target_tris": target, "tris": int(tris)})
    if not only:
        json.dump(meta, open(os.path.join(OUT, "parts.json"), "w"), indent=1)
    print("done")
